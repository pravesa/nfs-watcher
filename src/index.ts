/* eslint-disable no-console */
import EventEmitter from 'events';
import path from 'path';
import picomatch from 'picomatch';
import lsdirp from 'lsdirp';
import {unwatch, watch as notify, add} from './../index';

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
  private watcher: unknown;
  private dirs = new Set<string>();
  private ignored = ['**/node_modules', '**/.git', '**/target'];
  private includeMatcher: picomatch.Matcher | (() => boolean);
  private ignoreMatcher;

  constructor(dirs: string[], options: WatchOptions) {
    super();

    // Default lsdirp options
    const opts: Required<WatchOptions> = {
      ignored: [],
    };

    mergeObj(opts, options);

    this.ignored.push(...opts.ignored);

    this.normalizePattern(dirs, opts.ignored);

    this.includeMatcher = this.createMatcher(dirs);
    this.ignoreMatcher = this.createMatcher(this.ignored);

    this.watch(this.dirs);
  }

  // Private Methods

  // To initiate watcher instance on all matching paths, the patterns
  // are normalized using lsdirp and added to set object. By this way,
  // duplicate paths are watched only once.
  private normalizePattern(patterns: string[], ignored: string[]) {
    // Lists only matching directory file type
    const paths = lsdirp(patterns, {
      fileType: 'Directory',
      fullPath: true,
      flatten: true,
      ignorePaths: [...ignored],
    });

    paths.forEach((path) => {
      this.dirs.add(path);
    });
  }

  // This method creates matcher instance from the list of patterns.
  private createMatcher(patterns: string[]) {
    // Get the drive letter of the cwd if windows.
    const driveLetter =
      process.platform === 'win32' ? process.cwd().slice(0, 2) : '';

    const globPattern = patterns.map((pattern) => {
      const {base, glob} = picomatch.scan(pattern);

      return (
        driveLetter +
        path.posix.resolve('.', path.posix.join('.', base, glob || '**'))
      );
    });

    return picomatch(globPattern);
  }

  // This method initiates the native module notify with
  // path to be watched for fs events.
  private watch(paths: Set<string>) {
    // Pass the array of paths to be watched to the notify addon
    this.watcher = notify((err, data) => {
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
    paths.forEach((path) => {
      this.add(path);
    });
    this.emit('ready', 'watching for fs events');
  }

  // Public methods

  /**
   * This method adds the specified path to be watched for fs events
   * after the initial setup of the watcher instance.
   * @param path path to be watched for fs events
   */
  add(path: string) {
    try {
      if (typeof path !== 'string' || path === '') {
        throw new TypeError(
          `Expected argument type is 'string', but got '${typeof path}'`
        );
      }
      add(this.watcher, path);
    } catch (error) {
      this.emit('error', error);
    }
  }

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
    } else if (this.dirs.has(path)) {
      try {
        unwatch(this.watcher, path);
        this.emit('unwatch', 0, `${path} removed from watching`);
      } catch (error) {
        this.emit('error', error);
      }
      // Delete the path from set that was removed from watching
      this.dirs.delete(path);
    } else {
      this.emit('unwatch', 1, `${path} doesn't exist for unwatching`);
    }
  }

  /**
   * This method removes all paths from watching for fs events if exist.
   */
  unwatchAll() {
    try {
      this.dirs.forEach((path) => {
        unwatch(this.watcher, path);
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

  dir = typeof dir === 'string' ? [dir] : dir;

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

export = watch;
