/* eslint-disable no-console */
import EventEmitter from 'events';
import path from 'path';
import picomatch from 'picomatch';
import lsdirp from 'lsdirp';
import {statSync} from 'fs';
import {unwatch, watch as notify, add} from './../index.js';

// Options to configure watch
interface WatchOptions {
  /** To ignore any files or directories, add a list of patterns excluding
   * default ones. This might be tricky one, but it will be easier once get
   * used to it.
   * @default '["**\/node_modules", "**\/.git"]' */
  ignored?: string[];
  /** If true, poll watcher will be used. Use this feature when there is no
   * native watcher is available. eg: docker.
   *  @default false */
  usePolling?: boolean;
  /** Set the interval in seconds at which the file system should be polled
   * for fs events. keep the value above 1 sec to avoid frequent polling.
   * setting negative value will set usePolling option false.
   * @default 4 */
  pollInterval?: number;
}

// List of events that will be emitted by the watcher
type EventName = 'add' | 'addDir' | 'modify' | 'remove' | 'removeDir';

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
  private files = new Set<string>();
  private ignored = ['**/node_modules', '**/.git', '**/target'];
  private globPatterns = new Map<string, Set<string>>();
  private includePatterns = new Map<string, picomatch.Matcher>();
  private ignorePatterns = new Map<string, picomatch.Matcher>();

  constructor(dirs: string[], options: WatchOptions) {
    super();

    // Default lsdirp options
    const opts: Required<WatchOptions> = {
      ignored: [],
      usePolling: false,
      pollInterval: 4,
    };

    mergeObj(opts, options);

    this.ignored.push(...opts.ignored);

    this.normalizePattern(dirs, opts.ignored);

    this.createMatcher(dirs, this.includePatterns);
    this.createMatcher(this.ignored, this.ignorePatterns);

    this.watch(opts, this.dirs, this.files);
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

  private isFile(path: string) {
    return statSync(path).isFile();
  }

  private patternMatcher(
    path: string,
    matchers: Map<string, picomatch.Matcher>
  ) {
    for (const matcher of matchers) {
      if (path.startsWith(matcher[0])) {
        const result = matcher[1](path);
        if (result) {
          return true;
        }
      }
    }
    return false;
  }

  private isMatch(path: string) {
    return this.patternMatcher(path, this.includePatterns);
  }

  private isNotIgnored(path: string) {
    return !this.patternMatcher(path, this.ignorePatterns);
  }

  // This method creates matcher instance from the list of patterns.
  private createMatcher(
    patterns: string[],
    matchers: Map<string, picomatch.Matcher>
  ) {
    // Get the drive letter of the cwd if windows.
    const driveLetter =
      process.platform === 'win32' ? process.cwd().slice(0, 2) : '';

    patterns.forEach((pattern) => {
      let {base, glob} = picomatch.scan(pattern);

      base = driveLetter + path.posix.resolve('.', path.posix.join('.', base));

      const globs = this.globPatterns.get(base);

      if (glob === '') {
        if (this.isFile(base)) {
          this.files.add(base);
        } else {
          glob = '**';
        }
      }

      pattern = path.posix.join(base, glob);

      if (globs) {
        globs.add(pattern);
      } else {
        this.globPatterns.set(base, new Set<string>().add(pattern));
      }

      matchers.set(
        base,
        picomatch(Array.from(this.globPatterns.get(base) ?? []))
      );
    });
  }

  // This method initiates the native module notify with
  // path to be watched for fs events.
  private watch(opts: WatchOptions, dirs: Set<string>, files: Set<string>) {
    const {usePolling, pollInterval} = opts;

    // Pass the watch options as string and array of paths to be watched
    // to the notify addon
    this.watcher = notify(
      JSON.stringify({use_polling: usePolling, poll_interval: pollInterval}),
      (err, data) => {
        if (err) {
          // Emits 'error' event upon watch error from native module
          this.emit('error', err);
        }

        const event = JSON.parse(data) as {kind: EventName; path: string};

        event.path = event.path.replace(/\\/g, '/');

        if (this.isNotIgnored(event.path) && this.isMatch(event.path)) {
          switch (event.kind) {
            case 'addDir':
              this.dirs.add(event.path);
              this.add(event.path);
              break;
            case 'remove':
              if (this.dirs.has(event.path)) {
                event.kind = 'removeDir';
                this.unwatch(event.path);
              }
              break;
            default:
              break;
          }
          // Emits file system events
          this.emit(event.kind, event.path);
        }
      }
    );
    dirs.forEach((path) => {
      this.add(path);
    });
    files.forEach((path) => {
      this.add(path);
    });
    this.emit('ready', 'watching for fs events');
  }

  // Public methods

  /**
   * This method adds the specified path to be watched for fs events
   * after the initial setup of the watcher instance.
   * @param path {string} path to be watched for fs events
   */
  add(path: string) {
    try {
      if (typeof path !== 'string' || path === '') {
        throw new TypeError(
          `Expected argument type is 'string', but got '${typeof path}'`
        );
      }
      add(this.watcher, path);

      // Add the path to the respective set for unwatching the path later.
      if (this.isFile(path)) {
        this.files.add(path);
      } else {
        this.dirs.add(path);
      }
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * This method takes one optional argument and will remove the passed in
   * path from watching for fs events if it exist. This will remove all
   * paths from watching if no argument is passed (similar to `unwatchAll()`).
   * @param path {string} [] file or dir to be unwatched (optional)
   */
  unwatch(path?: string) {
    const unwatchPath = (path: string) => {
      try {
        unwatch(this.watcher, path);
        this.emit('unwatch', 0, `${path} removed from watching`);
      } catch (error) {
        this.emit('error', error);
      }
    };

    // Call unwatchAll() if argument is empty
    if (!path) {
      this.unwatchAll();
      // Unwatch the path if exist
    } else if (this.dirs.has(path)) {
      unwatchPath(path);
      this.dirs.delete(path);
    } else if (this.files.has(path)) {
      unwatchPath(path);
      this.files.delete(path);
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
      this.files.forEach((path) => {
        unwatch(this.watcher, path);
      });
      this.emit('unwatch', 0, 'all paths removed from watching');
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * @param eventName {'add' | 'addDir' | 'modify' | 'remove' | 'removeDir'}
   * @param listener {(path: string) => void}
   */
  override on(eventName: EventName, listener: (path: string) => void): this {
    return super.on(eventName, listener);
  }
}

let watcher: FsEvent;

/**
 * Options to configure watch
 * @typedef {object} WatchOptions
 * @property {string[]} ignored Ignores added files or directories from watching
 * @property {boolean} usePolling If true, poll watcher will be used
 * @property {number} pollInterval Set the interval in seconds at which the file system should be polled for fs events
 */

/**
 * Creates a singleton FsEvent instance
 * @param dir {string | string[]} files or dirs to be watched
 * @param options {WatchOptions} options to configure watcher
 * @returns {FsEvent} FsEvent instance
 */
const watch = (dir: string | string[], options: WatchOptions) => {
  if (!(typeof dir === 'string' || Array.isArray(dir))) {
    throw new TypeError('Watch dir should be string');
  }

  dir = typeof dir === 'string' ? [dir] : dir;

  if (!watcher) {
    watcher = new FsEvent(dir, options);
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

export default watch;
