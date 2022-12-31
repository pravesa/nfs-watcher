#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;
// extern crate globwalk;

use std::path::Path;

// use globwalk::FileType;
use napi::{
  bindgen_prelude::*,
  threadsafe_function::{
    ErrorStrategy, ThreadSafeCallContext, ThreadsafeFunction, ThreadsafeFunctionCallMode,
  },
  JsExternal, JsString, JsUndefined,
};
use notify::{recommended_watcher, Event, RecommendedWatcher, RecursiveMode, Watcher};

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

/// Watch for fs events using notify crate which implements native backends and polling feature.
/// This function takes in array of paths to be watched and a callback to be invoked at addon's
/// main thread.
#[napi(ts_args_type = "dirs: string[], callback: (err: null | Error, event: string) => void")]
pub fn watch(env: Env, dirs: Vec<JsString>, callback: JsFunction) -> Result<JsExternal> {
  // Javascript callback to be invoked for fs events
  let tsfn: ThreadsafeFunction<Event, ErrorStrategy::CalleeHandled> = callback
    .create_threadsafe_function(0, |cx: ThreadSafeCallContext<Event>| {
      Ok(vec![cx
        .env
        .create_string_from_std(serde_json::to_string(&cx.value)?)?])
    })?;

  // Creates recommended watcher with javascript callback as an event handler
  let mut watcher = recommended_watcher(move |ev: notify::Result<Event>| {
    tsfn.call(
      ev.map_err(|e| Error::new(Status::GenericFailure, format!("{}", e))),
      ThreadsafeFunctionCallMode::NonBlocking,
    );
  })
  .map_err(|e| Error::new(Status::GenericFailure, format!("{}", e)))?;

  // Initiate watcher for array of paths
  for dir in dirs {
    let dir = dir.into_utf8()?;

    watcher
      .watch(Path::new(dir.as_str()?), RecursiveMode::NonRecursive)
      .map_err(|e| Error::new(Status::GenericFailure, format!("{}", e)))?;
  }

  env.create_external(watcher, None)
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
