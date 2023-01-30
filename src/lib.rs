#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;
// extern crate globwalk;

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

// use globwalk::FileType;
use napi::{
  bindgen_prelude::*,
  threadsafe_function::{
    ErrorStrategy, ThreadSafeCallContext, ThreadsafeFunction, ThreadsafeFunctionCallMode,
  },
  JsExternal, JsString, JsUndefined,
};
use notify::{recommended_watcher, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
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
    self.kind != other.kind && self.path != other.path || self.ts >= other.ts + 50
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
#[napi(ts_args_type = "callback: (err: null | Error, event: string) => void")]
pub fn watch(env: Env, callback: JsFunction) -> Result<JsExternal> {
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

  // Creates recommended watcher with javascript callback as an event handler
  let watcher = recommended_watcher(move |ev: notify::Result<Event>| {
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
          EventKind::Modify(_) => String::from("modify"),
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
  })
  .map_err(|e| Error::new(Status::GenericFailure, format!("{}", e)))?;

  env.create_external(watcher, None)
}

/// This function takes in watcher instance and a path to be watched for events.
#[napi]
pub fn add(env: Env, ext: JsExternal, dir: JsString) -> Result<JsUndefined> {
  let dir = dir.into_utf8()?;
  let watcher = env.get_value_external::<RecommendedWatcher>(&ext)?;

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
  let watcher = env.get_value_external::<RecommendedWatcher>(&ext)?;

  watcher
    .unwatch(Path::new(dir.as_str()?))
    .map_err(|e| Error::new(Status::GenericFailure, format!("{}", e)))?;
  env.get_undefined()
}
