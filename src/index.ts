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
  #watcher: unknown;
  #dirs = new Set<string>();
  #files = new Set<string>();
  #ignored = ['**/node_modules', '**/.git', '**/target'];
  #includePatterns = new Map<string, [Set<string>, picomatch.Matcher]>();
  #ignorePatterns = new Map<string, [Set<string>, picomatch.Matcher]>();
  #recursivePatterns = new Map<string, [Set<string>, picomatch.Matcher]>();

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
        this.#ignored.push(ignored);
      }
    });

    this.#watch(opts);

    this.#createMatcher(this.#ignored, this.#ignorePatterns, true);
    process.nextTick(() => this.emit('ready', 'watching for fs events'));
  }

  // Methods

  /**
   * Normalizes the patterns passed by the user by listing only matching directory file type.
   * @param {string[]} patterns - List of file patterns to be normalized.
   * @returns {string[]} - An array of normalized directory file paths.
   */
  #normalizePattern(patterns: string[]): string[] {
    return lsdirp(patterns, {
      fileType: 'Directory',
      fullPath: true,
      flatten: true,
      ignorePaths: [...this.#ignored],
    });
  }

  /**
   * Determines if the given path is a file or not
   * @param {string} path - The file path to check
   * @returns {boolean} true if the path is a file, false otherwise
   */
  #isFile(path: string): boolean {
    return statSync(path).isFile();
  }

  /**
   * Determines if the given `path` matches a pattern defined in the `matchers` Map.
   * @param {string} path - The string to check for a match.
   * @param {Map<string, [Set<string>, picomatch.Matcher]>} matchers - The map of pattern matching information.
   * @returns {boolean} - Returns `true` if the `path` matches a pattern defined in the `matchers` Map, `false` otherwise.
   */
  #patternMatcher(
    path: string,
    matchers: Map<string, [Set<string>, picomatch.Matcher]>
  ): boolean {
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

  /**
   * Check if the given path matches any of the include patterns
   * @param {string} path - The path to check for matching
   * @returns {boolean} - Returns true if the path matches any of the include patterns, false otherwise
   */
  #isMatch(path: string): boolean {
    return this.#patternMatcher(path, this.#includePatterns);
  }

  /**
   * Check if the path should not be ignored based on the ignore patterns
   * @param {string} path - The file path to check against the ignore patterns
   * @returns {boolean} - Returns true if the path does not match any ignore pattern, false otherwise
   */
  #isNotIgnored(path: string): boolean {
    return !this.#patternMatcher(path, this.#ignorePatterns);
  }

  /**
   * Check if the given path matches a recursive pattern or not.
   * @param {string} path - The path to be checked.
   * @returns {boolean} - Returns `true` if the path matches a recursive pattern, `false` otherwise.
   */
  #isRecursiveMatch(path: string): boolean {
    return this.#patternMatcher(path, this.#recursivePatterns);
  }

  /**
   * Creates a matcher for the given `patterns` and adds it to the `matchers` Map.
   * @param {string[]} patterns - The patterns to create a matcher for.
   * @param {Map<string, [Set<string>, picomatch.Matcher]>} matchers - The map to add the created matcher to.
   * @param {boolean} isIgnored - A flag indicating whether the created matcher is for ignored patterns.
   */
  #createMatcher(
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

        if (glob === '') {
          if (!isIgnored && this.#isFile(base) && !this.#files.has(base)) {
            this.#files.add(base);
            this.#watchPath(base);
          } else {
            glob = '**';
          }
        }

        pattern = path.posix.join(base, glob);

        if (
          !isIgnored &&
          glob.indexOf('**') !== -1 &&
          !this.#recursivePatterns.has(base)
        ) {
          this.#recursivePatterns.set(base, [
            new Set<string>(),
            picomatch(path.posix.join(base, '**')),
          ]);
        }

        const matcher = matchers.get(base);

        if (matcher) {
          matcher[0].add(pattern);
          matcher[1] = picomatch(Array.from(matcher[0]));
        } else {
          matchers.set(base, [
            new Set<string>().add(pattern),
            picomatch(pattern),
          ]);
        }
      } catch (error) {
        process.nextTick(() => this.emit('error', error));
      }
    });
  }

  /**
   * Creates a watcher instance with the provided callback function and assigns it to watcher variable.
   * @param {WatchOptions} opts - Options for configuring watcher instance
   */
  #watch(opts: WatchOptions) {
    const {usePolling, pollInterval} = opts;

    // Pass the watch options as string and array of paths to be watched
    // to the notify addon
    this.#watcher = notify(
      JSON.stringify({use_polling: usePolling, poll_interval: pollInterval}),
      (err, data) => {
        if (err) {
          // Emits 'error' event upon watch error from native module
          this.emit('error', err);
        }

        const event = JSON.parse(data) as {kind: EventName; path: string};

        event.path = event.path.replace(/\\/g, '/');

        if (this.#isNotIgnored(event.path)) {
          if (event.kind === 'addDir' && this.#isRecursiveMatch(event.path)) {
            this.#dirs.add(event.path);
            this.#watchPath(event.path);
          } else if (event.kind === 'remove' && this.#dirs.has(event.path)) {
            event.kind = 'removeDir';
            this.unwatch(event.path);
          }

          if (this.#isMatch(event.path)) {
            // Emits file system events
            this.emit(event.kind, event.path);
            this.emit('all', event.kind, event.path);
          }
        }
      }
    );
  }

  /**
   * This method adds the specified path to the watcher for file changes.
   * @param {string} path - The file path to be watched.
   * @throws {Error} If an error occurs while adding the path to the watcher, the method emits an error event with the error.
   */
  #watchPath(path: string) {
    try {
      add(this.#watcher, path);
    } catch (error) {
      this.emit('error', error);
    }
  }

  /**
   * Removes a file/directory from the watcher's list of monitored targets.
   * @param path The path to the file/directory to stop monitoring.
   */
  #unwatchPath(path: string) {
    try {
      unwatch(this.#watcher, path);
    } catch (error) {
      this.emit('error', error);
    }
  }

  // Public methods

  /**
   * Adds the provided paths to be watched.
   * @param {string | string[]} paths - The paths to be watched.
   */
  add(paths: string | string[]) {
    paths = typeof paths === 'string' ? [paths] : paths;
    this.#createMatcher(paths, this.#includePatterns, false);

    this.#normalizePattern(paths).forEach((path) => {
      if (!this.#dirs.has(path)) {
        this.#dirs.add(path);
        this.#watchPath(path);
      }
    });
  }

  /**
   * Removes the provided paths from monitoring.
   * @param {string | string[]} paths - The paths to be stopped from monitoring.
   */
  unwatch(paths: string | string[]) {
    paths = typeof paths === 'string' ? [paths] : paths;

    paths.forEach((path) => {
      if (this.#dirs.delete(path) || this.#files.delete(path)) {
        this.#includePatterns.delete(path);
        this.#unwatchPath(path);
      } else {
        this.emit('error', 1, `${path} doesn't exist for unwatching`);
      }
    });
  }

  /**
   * Closes the file/directory watcher.
   * This method removes all event listeners, unwatches all directories and files, and clears all fields.
   */
  close() {
    this.removeAllListeners();

    this.#dirs.forEach((path) => {
      this.#unwatchPath(path);
    });
    this.#files.forEach((path) => {
      this.#unwatchPath(path);
    });

    // Clear all fields
    this.#dirs.clear();
    this.#files.clear();
    this.#includePatterns.clear();
    this.#ignorePatterns.clear();
    this.#recursivePatterns.clear();
  }

  override on(eventName: EventName, listener: (path: string) => void): this;
  override on(
    eventName: 'all',
    listener: (event: EventName, path: string) => void
  ): this;
  override on(eventName: 'error', listener: (error: Error) => void): this;
  /**
   * @param eventName {'add' | 'addDir' | 'modify' | 'remove' | 'removeDir' | 'all' | 'error'}
   * @param listener {((path: string) => void) | ((event: 'add' | 'addDir' | 'modify' | 'remove' | 'removeDir', path: string) => void) | ((error: Error) => void)}
   */
  override on(
    eventName: string | symbol,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listener: (...args: any[]) => void
  ): this {
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
  watcher.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  process.emit('SIGTERM');
});

export default watch;
