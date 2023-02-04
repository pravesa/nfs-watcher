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
  private includePatterns = new Map<string, [Set<string>, picomatch.Matcher]>();
  private ignorePatterns = new Map<string, [Set<string>, picomatch.Matcher]>();

  constructor(options: WatchOptions) {
    super();

    // Default lsdirp options
    const opts: Required<WatchOptions> = {
      ignored: [],
      usePolling: false,
      pollInterval: 4,
    };

    mergeObj(opts, options);

    // Push only non-empty string into ignored field for creating matcher.
    opts.ignored.forEach((ignored) => {
      if (typeof ignored === 'string' && ignored !== '') {
        this.ignored.push(ignored);
      }
    });

    this.watch(opts);

    this.createMatcher(this.ignored, this.ignorePatterns, true);
    process.nextTick(() => this.emit('ready', 'watching for fs events'));
  }

  // Private Methods

  // To initiate watcher instance on all matching paths, the patterns
  // are normalized using lsdirp and added to set object. By this way,
  // duplicate paths are watched only once.
  private normalizePattern(patterns: string[]) {
    // Lists only matching directory file type
    return lsdirp(patterns, {
      fileType: 'Directory',
      fullPath: true,
      flatten: true,
      ignorePaths: [...this.ignored],
    });
  }

  private isFile(path: string) {
    return statSync(path).isFile();
  }

  private patternMatcher(
    path: string,
    matchers: Map<string, [Set<string>, picomatch.Matcher]>
  ) {
    for (const matcher of matchers) {
      if (path.startsWith(matcher[0])) {
        const result = matcher[1][1](path);
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
    matchers: Map<string, [Set<string>, picomatch.Matcher]>,
    isIgnored: boolean
  ) {
    // Get the drive letter of the cwd if windows.
    const driveLetter =
      process.platform === 'win32' ? process.cwd().slice(0, 2) : '';

    patterns.forEach((pattern) => {
      try {
        if (typeof pattern !== 'string' || pattern === '') {
          throw TypeError(
            `Expected argument type is 'string', but got '${typeof pattern}'`
          );
        }
        pattern = (pattern[0] === '/' ? '.' : '') + pattern;
        let {base, glob} = picomatch.scan(pattern);

        base =
          driveLetter +
          path.posix.resolve('.', path.relative('.', base)).replace(/\\/g, '/');

        let matcher = matchers.get(base);

        if (glob === '') {
          if (!isIgnored && this.isFile(base) && !this.files.has(base)) {
            this.files.add(base);
            this.watchPath(base);
          } else {
            glob = '**';
          }
        }

        pattern = path.posix.join(base, glob);

        if (matcher) {
          matcher[0].add(pattern);
        } else {
          matchers.set(base, [new Set<string>().add(pattern), () => true]);
        }

        matcher = matchers.get(base);

        if (matcher) {
          matcher[1] = picomatch(Array.from(matcher[0]));
        }
      } catch (error) {
        process.nextTick(() => this.emit('error', error));
      }
    });
  }

  // This method initiates the native module notify with
  // path to be watched for fs events.
  private watch(opts: WatchOptions) {
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
              this.watchPath(event.path);
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
  }

  private watchPath(path: string) {
    try {
      add(this.watcher, path);
    } catch (error) {
      this.emit('error', error);
    }
  }

  private unwatchPath(path: string) {
    try {
      unwatch(this.watcher, path);
    } catch (error) {
      this.emit('error', error);
    }
  }

  // Public methods

  /**
   * This method adds the specified path to be watched for fs events
   * after the initial setup of the watcher instance.
   * @param path {string} path to be watched for fs events
   */
  add(paths: string | string[]) {
    paths = typeof paths === 'string' ? [paths] : paths;
    this.createMatcher(paths, this.includePatterns, false);

    this.normalizePattern(paths).forEach((path) => {
      if (!this.dirs.has(path)) {
        this.dirs.add(path);
        this.watchPath(path);
      }
    });
  }

  /**
   * This method takes one optional argument and will remove the passed in
   * path from watching for fs events if it exist. This will remove all
   * paths from watching if no argument is passed (similar to `unwatchAll()`).
   * @param path {string} [] file or dir to be unwatched (optional)
   */
  unwatch(paths: string | string[]) {
    paths = typeof paths === 'string' ? [paths] : paths;

    paths.forEach((path) => {
      if (this.dirs.delete(path) || this.files.delete(path)) {
        this.includePatterns.delete(path);
        this.unwatchPath(path);
      } else {
        this.emit('error', 1, `${path} doesn't exist for unwatching`);
      }
    });
  }

  /**
   * This method removes all paths from watching for fs events if exist.
   */
  unwatchAll() {
    this.dirs.forEach((path) => {
      this.unwatchPath(path);
    });
    this.files.forEach((path) => {
      this.unwatchPath(path);
    });

    // Clear all fields except ignorePatterns
    this.dirs.clear();
    this.files.clear();
    this.includePatterns.clear();
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
const watch = (dir: string | string[], options: WatchOptions): FsEvent => {
  if (!watcher) {
    watcher = new FsEvent(options);
    watcher.add(dir);
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
