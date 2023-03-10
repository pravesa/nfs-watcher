import {existsSync, readFileSync} from 'fs';
import {join} from 'path';
import {createRequire} from 'module';

const require = createRequire(import.meta.url);

const {platform, arch} = process;
const cwd = process.cwd();

let nativeBinding = null;
let localFileExisted = false;
let loadError = null;

function isMusl() {
  // For Node 10
  if (!process.report || typeof process.report.getReport !== 'function') {
    try {
      const lddPath = require('child_process')
        .execSync('which ldd')
        .toString()
        .trim();
      return readFileSync(lddPath, 'utf8').includes('musl');
    } catch (e) {
      return true;
    }
  } else {
    const {glibcVersionRuntime} = process.report.getReport().header;
    return !glibcVersionRuntime;
  }
}

switch (platform) {
  case 'android':
    switch (arch) {
      case 'arm64':
        localFileExisted = existsSync(
          join(cwd, 'nfs-watcher.android-arm64.node')
        );
        try {
          if (localFileExisted) {
            nativeBinding = require('./nfs-watcher.android-arm64.node');
          } else {
            nativeBinding = require('nfs-watcher-android-arm64');
          }
        } catch (e) {
          loadError = e;
        }
        break;
      case 'arm':
        localFileExisted = existsSync(
          join(cwd, 'nfs-watcher.android-arm-eabi.node')
        );
        try {
          if (localFileExisted) {
            nativeBinding = require('./nfs-watcher.android-arm-eabi.node');
          } else {
            nativeBinding = require('nfs-watcher-android-arm-eabi');
          }
        } catch (e) {
          loadError = e;
        }
        break;
      default:
        throw new Error(`Unsupported architecture on Android ${arch}`);
    }
    break;
  case 'win32':
    switch (arch) {
      case 'x64':
        localFileExisted = existsSync(
          join(cwd, 'nfs-watcher.win32-x64-msvc.node')
        );
        try {
          if (localFileExisted) {
            nativeBinding = require('./nfs-watcher.win32-x64-msvc.node');
          } else {
            nativeBinding = require('nfs-watcher-win32-x64-msvc');
          }
        } catch (e) {
          loadError = e;
        }
        break;
      case 'ia32':
        localFileExisted = existsSync(
          join(cwd, 'nfs-watcher.win32-ia32-msvc.node')
        );
        try {
          if (localFileExisted) {
            nativeBinding = require('./nfs-watcher.win32-ia32-msvc.node');
          } else {
            nativeBinding = require('nfs-watcher-win32-ia32-msvc');
          }
        } catch (e) {
          loadError = e;
        }
        break;
      case 'arm64':
        localFileExisted = existsSync(
          join(cwd, 'nfs-watcher.win32-arm64-msvc.node')
        );
        try {
          if (localFileExisted) {
            nativeBinding = require('./nfs-watcher.win32-arm64-msvc.node');
          } else {
            nativeBinding = require('nfs-watcher-win32-arm64-msvc');
          }
        } catch (e) {
          loadError = e;
        }
        break;
      default:
        throw new Error(`Unsupported architecture on Windows: ${arch}`);
    }
    break;
  case 'darwin':
    localFileExisted = existsSync(
      join(cwd, 'nfs-watcher.darwin-universal.node')
    );
    try {
      if (localFileExisted) {
        nativeBinding = require('./nfs-watcher.darwin-universal.node');
      } else {
        nativeBinding = require('nfs-watcher-darwin-universal');
      }
      break;
    } catch {
      /* empty */
    }
    switch (arch) {
      case 'x64':
        localFileExisted = existsSync(join(cwd, 'nfs-watcher.darwin-x64.node'));
        try {
          if (localFileExisted) {
            nativeBinding = require('./nfs-watcher.darwin-x64.node');
          } else {
            nativeBinding = require('nfs-watcher-darwin-x64');
          }
        } catch (e) {
          loadError = e;
        }
        break;
      case 'arm64':
        localFileExisted = existsSync(
          join(cwd, 'nfs-watcher.darwin-arm64.node')
        );
        try {
          if (localFileExisted) {
            nativeBinding = require('./nfs-watcher.darwin-arm64.node');
          } else {
            nativeBinding = require('nfs-watcher-darwin-arm64');
          }
        } catch (e) {
          loadError = e;
        }
        break;
      default:
        throw new Error(`Unsupported architecture on macOS: ${arch}`);
    }
    break;
  case 'freebsd':
    if (arch !== 'x64') {
      throw new Error(`Unsupported architecture on FreeBSD: ${arch}`);
    }
    localFileExisted = existsSync(join(cwd, 'nfs-watcher.freebsd-x64.node'));
    try {
      if (localFileExisted) {
        nativeBinding = require('./nfs-watcher.freebsd-x64.node');
      } else {
        nativeBinding = require('nfs-watcher-freebsd-x64');
      }
    } catch (e) {
      loadError = e;
    }
    break;
  case 'linux':
    switch (arch) {
      case 'x64':
        if (isMusl()) {
          localFileExisted = existsSync(
            join(cwd, 'nfs-watcher.linux-x64-musl.node')
          );
          try {
            if (localFileExisted) {
              nativeBinding = require('./nfs-watcher.linux-x64-musl.node');
            } else {
              nativeBinding = require('nfs-watcher-linux-x64-musl');
            }
          } catch (e) {
            loadError = e;
          }
        } else {
          localFileExisted = existsSync(
            join(cwd, 'nfs-watcher.linux-x64-gnu.node')
          );
          try {
            if (localFileExisted) {
              nativeBinding = require('./nfs-watcher.linux-x64-gnu.node');
            } else {
              nativeBinding = require('nfs-watcher-linux-x64-gnu');
            }
          } catch (e) {
            loadError = e;
          }
        }
        break;
      case 'arm64':
        if (isMusl()) {
          localFileExisted = existsSync(
            join(cwd, 'nfs-watcher.linux-arm64-musl.node')
          );
          try {
            if (localFileExisted) {
              nativeBinding = require('./nfs-watcher.linux-arm64-musl.node');
            } else {
              nativeBinding = require('nfs-watcher-linux-arm64-musl');
            }
          } catch (e) {
            loadError = e;
          }
        } else {
          localFileExisted = existsSync(
            join(cwd, 'nfs-watcher.linux-arm64-gnu.node')
          );
          try {
            if (localFileExisted) {
              nativeBinding = require('./nfs-watcher.linux-arm64-gnu.node');
            } else {
              nativeBinding = require('nfs-watcher-linux-arm64-gnu');
            }
          } catch (e) {
            loadError = e;
          }
        }
        break;
      case 'arm':
        localFileExisted = existsSync(
          join(cwd, 'nfs-watcher.linux-arm-gnueabihf.node')
        );
        try {
          if (localFileExisted) {
            nativeBinding = require('./nfs-watcher.linux-arm-gnueabihf.node');
          } else {
            nativeBinding = require('nfs-watcher-linux-arm-gnueabihf');
          }
        } catch (e) {
          loadError = e;
        }
        break;
      default:
        throw new Error(`Unsupported architecture on Linux: ${arch}`);
    }
    break;
  default:
    throw new Error(`Unsupported OS: ${platform}, architecture: ${arch}`);
}

if (!nativeBinding) {
  if (loadError) {
    throw loadError;
  }
  throw new Error(`Failed to load native binding`);
}

export const {watch, add, unwatch} = nativeBinding;
