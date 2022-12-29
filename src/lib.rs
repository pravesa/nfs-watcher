#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

use std::path::Path;

use napi::{
  bindgen_prelude::*,
  threadsafe_function::{
    ErrorStrategy, ThreadSafeCallContext, ThreadsafeFunction, ThreadsafeFunctionCallMode,
  },
  JsExternal, JsString, JsUndefined,
};
use notify::{recommended_watcher, Event, RecommendedWatcher, RecursiveMode, Watcher};

#[napi(ts_args_type = "dir: string, callback: (err: null | Error, event: string) => void")]
pub fn watch(env: Env, dir: JsString, callback: JsFunction) -> Result<JsExternal> {
  let dir = dir.into_utf8()?;

  let tsfn: ThreadsafeFunction<Event, ErrorStrategy::CalleeHandled> = callback
    .create_threadsafe_function(0, |cx: ThreadSafeCallContext<Event>| {
      Ok(vec![cx
        .env
        .create_string_from_std(serde_json::to_string(&cx.value)?)?])
    })?;

  let mut watcher = recommended_watcher(move |ev: notify::Result<Event>| {
    tsfn.call(
      ev.map_err(|e| Error::new(Status::GenericFailure, format!("{}", e))),
      ThreadsafeFunctionCallMode::NonBlocking,
    );
  })
  .map_err(|e| Error::new(Status::GenericFailure, format!("{}", e)))?;

  watcher
    .watch(Path::new(dir.as_str()?), RecursiveMode::Recursive)
    .map_err(|e| Error::new(Status::GenericFailure, format!("{}", e)))?;

  env.create_external(watcher, None)
}

#[napi]
pub fn unwatch(env: Env, ext: JsExternal, dir: JsString) -> Result<JsUndefined> {
  let dir = dir.into_utf8()?;
  let watcher = env.get_value_external::<RecommendedWatcher>(&ext)?;

  watcher
    .unwatch(Path::new(dir.as_str()?))
    .map_err(|e| Error::new(Status::GenericFailure, format!("{}", e)))?;
  env.get_undefined()
}
