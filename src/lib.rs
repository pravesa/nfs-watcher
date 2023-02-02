#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;
// extern crate globwalk;

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

// use globwalk::FileType;
use napi::{
  bindgen_prelude::*,
  threadsafe_function::{
    ErrorStrategy, ThreadSafeCallContext, ThreadsafeFunction, ThreadsafeFunctionCallMode,
  },
  JsExternal, JsString, JsUndefined,
};
use notify::{
  event::{ModifyKind, RenameMode},
  Config, Event, EventKind, PollWatcher, RecommendedWatcher, RecursiveMode, Watcher,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
// FsEvent type
pub struct FsEvent {
  kind: String,
  path: PathBuf,
  ts: u128,
}

impl FsEvent {
  fn new(kind: String, path: PathBuf, ts: u128) -> Self {
    FsEvent { kind, path, ts }
  }
}

// PartialEq implementation for FsEvent where the curr_ev and prev_ev is checked
// for not-equality.
impl PartialEq for FsEvent {
  fn eq(&self, other: &Self) -> bool {
    self.kind == other.kind && self.path == other.path && self.ts == other.ts
  }

  fn ne(&self, other: &Self) -> bool {
    // Don't invoke callback function if the event kind is other
    if self.kind == "other" {
      return false;
    }
    self.kind != other.kind || self.path != other.path || self.ts >= other.ts + 50
  }
}

// Options to configure watcher instance
#[derive(Serialize, Deserialize, Debug)]
struct WatchOptions {
  use_polling: bool,
}

// Implement default value for watchoptions. This will be
// used if there is an error parsing json.
impl Default for WatchOptions {
  fn default() -> Self {
    Self { use_polling: false }
  }
}

// Filtering dirs using glob patterns for watching can also be done by using globwalk crate.
// But it will result in bigger output size.
//
// fn walkdir() -> Result<()> {
//   let walker = globwalk::GlobWalkerBuilder::from_patterns(
//     std::env::current_dir()?,
//     &["node_modules", "!**/.git", "!**/node_modules", "!**/target"],
//   )
//   .file_type(FileType::DIR)
//   .build()
//   .map_err(|e| Error::new(Status::GenericFailure, format!("{}", e)))?
//   .into_iter();

//   for dir in walker {
//     if let Ok(direntry) = dir {
//       // watch the matched paths for fs events
//     }
//   }

//   Ok(())
// }

/// Initiates recommended watcher instance with threadsafe callback function from
/// node js main thread and call the callback on fs events. This function returns
/// watcher instance which can be used to add paths to be watched for fs events.
#[napi(ts_args_type = "options: string, callback: (err: null | Error, event: string) => void")]
pub fn watch(env: Env, opts: JsString, callback: JsFunction) -> Result<JsExternal> {
  let options: WatchOptions = serde_json::from_str(opts.into_utf8()?.as_str()?).unwrap_or_default();

  // Javascript callback to be invoked for fs events
  let tsfn: ThreadsafeFunction<FsEvent, ErrorStrategy::CalleeHandled> = callback
    .create_threadsafe_function(0, |cx: ThreadSafeCallContext<FsEvent>| {
      Ok(vec![cx
        .env
        .create_string_from_std(serde_json::to_string(&cx.value)?)?])
    })?;

  // Assign the current event if this is not equal to it. This ensures that the callback
  // function will not be called for duplicate events within 50 ms of time.
  let mut evt: std::result::Result<FsEvent, notify::Error> =
    Ok(FsEvent::new(String::new(), PathBuf::new(), 0));

  let mut event_handler = move |ev: notify::Result<Event>| {
    // Mutable reference to previous event
    let prev_ev = &mut evt;

    // Get the current timestamp for comparing the duplicate event
    let timestamp = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .unwrap()
      .as_millis();

    // Convert the notify event type into FsEvent type.
    let curr_ev = ev.and_then(|evt| {
      let path = evt.paths[0].clone();
      let dir_suffix = if path.is_dir() { "Dir" } else { "" };

      Ok(FsEvent::new(
        match evt.kind {
          EventKind::Create(_) => String::from("add") + dir_suffix,
          EventKind::Modify(kind) => match kind {
            ModifyKind::Data(_) => String::from("modify"),
            // Handle rename event as remove and add event
            ModifyKind::Name(RenameMode::From) => String::from("remove") + dir_suffix,
            ModifyKind::Name(RenameMode::To) => String::from("add") + dir_suffix,
            _ => String::from("other"),
          },
          EventKind::Remove(_) => String::from("remove") + dir_suffix,
          _ => String::from("other"),
        },
        path,
        timestamp,
      ))
    });

    // Invoke the callback function if the curr_ev is error type or not equal to prev_ev.
    if curr_ev.is_err() || curr_ev.as_ref().unwrap() != prev_ev.as_ref().unwrap() {
      // Assign curr_ev to prev_ev if not an error type
      if let Ok(ev) = curr_ev.as_ref() {
        *prev_ev = Ok(ev.clone());
      }
      tsfn.call(
        curr_ev.map_err(|e| Error::new(Status::GenericFailure, format!("{}", e))),
        ThreadsafeFunctionCallMode::NonBlocking,
      );
    }
  };

  // Creates dynamic watcher with javascript callback as an event handler. If the use_polling
  // option is true, creates poll watcher instance else recommended watcher.
  let watcher: Box<dyn Watcher> = if options.use_polling {
    Box::new(
      PollWatcher::new(
        move |ev| event_handler(ev),
        Config::default().with_poll_interval(Duration::from_secs(4)),
      )
      .map_err(|e| Error::new(Status::GenericFailure, format!("{}", e)))?,
    )
  } else {
    Box::new(
      RecommendedWatcher::new(move |ev| event_handler(ev), Config::default())
        .map_err(|e| Error::new(Status::GenericFailure, format!("{}", e)))?,
    )
  };

  env.create_external(watcher, None)
}

/// This function takes in watcher instance and a path to be watched for events.
#[napi]
pub fn add(env: Env, ext: JsExternal, dir: JsString) -> Result<JsUndefined> {
  let dir = dir.into_utf8()?;
  let watcher = env.get_value_external::<Box<dyn Watcher>>(&ext)?;

  watcher
    .watch(Path::new(dir.as_str()?), RecursiveMode::NonRecursive)
    .map_err(|e| Error::new(Status::GenericFailure, format!("{}", e)))?;
  env.get_undefined()
}

/// This function invokes unwatch method on the specific path and removes that path
/// from watching for fs events.
#[napi]
pub fn unwatch(env: Env, ext: JsExternal, dir: JsString) -> Result<JsUndefined> {
  let dir = dir.into_utf8()?;
  let watcher = env.get_value_external::<Box<dyn Watcher>>(&ext)?;

  watcher
    .unwatch(Path::new(dir.as_str()?))
    .map_err(|e| Error::new(Status::GenericFailure, format!("{}", e)))?;
  env.get_undefined()
}
