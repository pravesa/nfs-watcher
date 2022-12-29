/* eslint-disable no-console */
import EventEmitter from 'events';
import {unwatch, watch as notify} from './../index';

// FsEvent class emits various file system events with optional
// arguments.
class FsEvent extends EventEmitter {
  unwatch: () => void = () => undefined;

  constructor(dir: string) {
    super();
    this.unwatch = this.watch(dir);
  }

  // Private Methods

  // This method initiates the native module notify with
  // path to be watched for fs events.
  private watch(dir: string) {
    const watcher = notify(dir, (err, data) => {
      if (err) {
        // Emits 'error' event upon watch error from native module
        this.emit('error', err);
      }

      // Emits 'all' event with stringified event from native module
      this.emit('all', JSON.parse(data));
    });
    return () => unwatch(watcher, dir);
  }
}

let watcher: FsEvent;

// This function creates single instance of FsEvent with passed in arguments
const watch = (dir: string) => {
  if (typeof dir !== 'string') {
    throw new TypeError('Watch dir should be string');
  }

  if (!watcher) {
    watcher = new FsEvent(dir);
  }
  return watcher;
};

// eslint-disable-next-line import/prefer-default-export
export {watch};
