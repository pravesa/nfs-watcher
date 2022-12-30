/* eslint-disable no-console */
import EventEmitter from 'events';
import picomatch from 'picomatch';
import {unwatch, watch as notify} from './../index';

// Options to configure watch
interface WatchOptions {
  /** To ignore any files or directories, add a list of patterns excluding
   * default ones. This might be tricky one, but it will be easier once get
   * used to it.
   * @default '["**\/node_modules", "**\/.git"]' */
  ignored?: string[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mergeObj = <T extends Record<string, any>>(target: T, source: T) => {
  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(target, key)) {
      target[key] = source[key] ?? target[key];
    }
  }
};

// FsEvent class emits various file system events with optional
// arguments.
class FsEvent extends EventEmitter {
  private dirs = new Set<string>();
  private includeMatcher: picomatch.Matcher | (() => boolean);
  private ignoreMatcher;
  private unwatchPaths = new Map<string, () => void>();

  constructor(dirs: string[], options: WatchOptions) {
    super();

    // Default lsdirp options
    const opts: Required<WatchOptions> = {
      ignored: [],
    };

    mergeObj(opts, options);

    ['**/node_modules/*', '**/.git/*'].forEach((ignored) => {
      if (opts.ignored?.indexOf(ignored) === -1) {
        opts.ignored.push(ignored);
      }
    });

    const globs = this.scanGlob(dirs);

    this.includeMatcher = globs.length !== 0 ? picomatch(globs) : () => true;
    this.ignoreMatcher = picomatch(opts.ignored);

    this.watch(this.dirs);
  }

  // Private Methods

  private scanGlob(patterns: string[]) {
    const globs: string[] = [];

    patterns.forEach((pattern) => {
      const {base, glob} = picomatch.scan(pattern);
      this.dirs.add(base);
      if (glob !== '') {
        globs.push(glob);
      }
    });

    if (this.dirs.has('.') && this.dirs.size > 1) {
      this.dirs.delete('.');
    }
    return globs;
  }

  // This method initiates the native module notify with
  // path to be watched for fs events.
  private watch(paths: Set<string>) {
    paths.forEach((path) => {
      if (!this.ignoreMatcher(path)) {
        const watcher = notify(path, (err, data) => {
          if (err) {
            // Emits 'error' event upon watch error from native module
            this.emit('error', err);
          }

          const event = JSON.parse(data) as {type: string; paths: string[]};

          event.paths[0] = event.paths[0].replace(/\\/g, '/');

          if (
            !this.ignoreMatcher(event.paths[0]) &&
            this.includeMatcher(event.paths[0])
          ) {
            // Emits 'all' event with stringified event from native module
            this.emit('all', event);
          }
        });
        this.unwatchPaths.set(path, () => unwatch(watcher, path));
      }
    });
  }

  // Public methods

  /**
   * This method takes one optional argument and will remove the passed in
   * path from watching for fs events if it exist. This will remove all
   * paths from watching if no argument is passed (similar to `unwatchAll()`).
   * @param path file or dir to be unwatched (optional)
   */
  unwatch(path?: string) {
    // Call unwatchAll() if argument is empty
    if (!path) {
      this.unwatchAll();
      // Unwatch the path if exist
    } else if (this.unwatchPaths.has(path)) {
      const func = this.unwatchPaths.get(path);
      if (typeof func === 'function') {
        try {
          func();
          this.emit('unwatch', 0, `${path} removed from watching`);
        } catch (error) {
          this.emit('error', error);
        }
      }
      // Delete the path from map that was removed from watching
      this.unwatchPaths.delete(path);
    } else {
      this.emit('unwatch', 1, `${path} doesn't exist for unwatching`);
    }
  }

  /**
   * This method removes all paths from watching for fs events if exist.
   */
  unwatchAll() {
    try {
      this.unwatchPaths.forEach((func) => {
        func();
      });
      this.emit('unwatch', 0, 'all paths removed from watching');
    } catch (error) {
      this.emit('error', error);
    }
  }
}

let watcher: FsEvent;

// This function creates single instance of FsEvent with passed in arguments
const watch = (dir: string | string[]) => {
  if (!(typeof dir === 'string' || Array.isArray(dir))) {
    throw new TypeError('Watch dir should be string');
  }

  dir = typeof dir === 'string' ? (dir === '.' ? [process.cwd()] : [dir]) : dir;

  if (!watcher) {
    watcher = new FsEvent(dir, {});
  }
  return watcher;
};

// Unwatch all paths on process exit
process.on('SIGTERM', () => {
  watcher.unwatchAll();
  process.exit(0);
});

process.on('SIGINT', () => {
  process.emit('SIGTERM');
});

// eslint-disable-next-line import/prefer-default-export
export {watch};