"use strict";

// The original modules stay byte-identical. Explicit getters retain the root
// export contract and let native Node discover the CommonJS named exports.
const types = require("./dist/types.js");
const schema = require("./dist/schema.js");
const config = require("./dist/cli-config.js");
const storage = require("./dist/cred-storage.js");

Object.defineProperty(exports, "__esModule", { value: true });
Object.defineProperty(exports, "CRED_STORAGE_CONFIG_VALUES", { enumerable: true, get: function () { return types.CRED_STORAGE_CONFIG_VALUES; } });
Object.defineProperty(exports, "CRED_STORAGE_VALUES", { enumerable: true, get: function () { return types.CRED_STORAGE_VALUES; } });
Object.defineProperty(exports, "DEFAULT_CRED_STORAGE", { enumerable: true, get: function () { return types.DEFAULT_CRED_STORAGE; } });
Object.defineProperty(exports, "authConfigHasUsableTokenData", { enumerable: true, get: function () { return storage.authConfigHasUsableTokenData; } });
Object.defineProperty(exports, "authConfigSchema", { enumerable: true, get: function () { return schema.authConfigSchema; } });
Object.defineProperty(exports, "credStorageSchema", { enumerable: true, get: function () { return schema.credStorageSchema; } });
Object.defineProperty(exports, "defaultAuthConfig", { enumerable: true, get: function () { return config.defaultAuthConfig; } });
Object.defineProperty(exports, "defaultGlobalConfig", { enumerable: true, get: function () { return config.defaultGlobalConfig; } });
Object.defineProperty(exports, "deleteAuthConfig", { enumerable: true, get: function () { return config.deleteAuthConfig; } });
Object.defineProperty(exports, "deleteAuthConfigFile", { enumerable: true, get: function () { return config.deleteAuthConfigFile; } });
Object.defineProperty(exports, "getAuthConfigFilePath", { enumerable: true, get: function () { return config.getAuthConfigFilePath; } });
Object.defineProperty(exports, "getCachePath", { enumerable: true, get: function () { return config.getCachePath; } });
Object.defineProperty(exports, "getConfigFilePath", { enumerable: true, get: function () { return config.getConfigFilePath; } });
Object.defineProperty(exports, "getDataPath", { enumerable: true, get: function () { return config.getDataPath; } });
Object.defineProperty(exports, "getDefaultAuthConfig", { enumerable: true, get: function () { return config.getDefaultAuthConfig; } });
Object.defineProperty(exports, "getGlobalPathConfig", { enumerable: true, get: function () { return config.getGlobalPathConfig; } });
Object.defineProperty(exports, "getLikelyEffectiveCredStorage", { enumerable: true, get: function () { return storage.getLikelyEffectiveCredStorage; } });
Object.defineProperty(exports, "globalConfigSchema", { enumerable: true, get: function () { return schema.globalConfigSchema; } });
Object.defineProperty(exports, "guidanceConfigSchema", { enumerable: true, get: function () { return schema.guidanceConfigSchema; } });
Object.defineProperty(exports, "parseAuthConfig", { enumerable: true, get: function () { return config.parseAuthConfig; } });
Object.defineProperty(exports, "parseAuthFileConfig", { enumerable: true, get: function () { return config.parseAuthFileConfig; } });
Object.defineProperty(exports, "parseGlobalConfig", { enumerable: true, get: function () { return config.parseGlobalConfig; } });
Object.defineProperty(exports, "readAuthConfig", { enumerable: true, get: function () { return config.readAuthConfig; } });
Object.defineProperty(exports, "readAuthConfigFile", { enumerable: true, get: function () { return config.readAuthConfigFile; } });
Object.defineProperty(exports, "readAuthFileConfig", { enumerable: true, get: function () { return config.readAuthFileConfig; } });
Object.defineProperty(exports, "readConfigFile", { enumerable: true, get: function () { return config.readConfigFile; } });
Object.defineProperty(exports, "readGlobalConfigFile", { enumerable: true, get: function () { return config.readGlobalConfigFile; } });
Object.defineProperty(exports, "telemetryConfigSchema", { enumerable: true, get: function () { return schema.telemetryConfigSchema; } });
Object.defineProperty(exports, "tryReadAuthConfig", { enumerable: true, get: function () { return config.tryReadAuthConfig; } });
Object.defineProperty(exports, "updatesConfigSchema", { enumerable: true, get: function () { return schema.updatesConfigSchema; } });
Object.defineProperty(exports, "writeAuthConfig", { enumerable: true, get: function () { return config.writeAuthConfig; } });
Object.defineProperty(exports, "writeAuthConfigFile", { enumerable: true, get: function () { return config.writeAuthConfigFile; } });
Object.defineProperty(exports, "writeConfigFile", { enumerable: true, get: function () { return config.writeConfigFile; } });
Object.defineProperty(exports, "writeGlobalConfigFile", { enumerable: true, get: function () { return config.writeGlobalConfigFile; } });
