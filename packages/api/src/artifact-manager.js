"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArtifactManager = void 0;
const fs = __importStar(require("fs-extra"));
const path = __importStar(require("path"));
class ArtifactManager {
    runDir;
    constructor(runId) {
        this.runDir = path.join(process.cwd(), 'runs', runId);
    }
    async initialize() {
        await fs.ensureDir(this.runDir);
        await fs.ensureDir(path.join(this.runDir, 'videos'));
        return {
            runDir: this.runDir,
            tracingPath: path.join(this.runDir, 'trace.zip'),
            videoPath: null, // Will be set later
            reportPath: path.join(this.runDir, 'report.html'),
            harPath: path.join(this.runDir, 'network.har'),
            logsPath: path.join(this.runDir, 'console.log')
        };
    }
    async saveNetworkHAR(networkEntries) {
        const har = {
            log: {
                version: '1.2',
                creator: { name: 'BugBot', version: '1.0.0' },
                entries: networkEntries.map(entry => ({
                    startedDateTime: new Date(entry.timestamp).toISOString(),
                    request: {
                        method: entry.method,
                        url: entry.url,
                        headers: Object.entries(entry.requestHeaders || {}).map(([name, value]) => ({
                            name,
                            value: String(value)
                        })),
                        httpVersion: 'HTTP/1.1'
                    },
                    response: {
                        status: entry.status || 0,
                        statusText: entry.status ? (entry.status < 400 ? 'OK' : 'Error') : 'Pending',
                        headers: Object.entries(entry.responseHeaders || {}).map(([name, value]) => ({
                            name,
                            value: String(value)
                        })),
                        httpVersion: 'HTTP/1.1'
                    },
                    timings: {
                        wait: 0,
                        receive: 0,
                        send: 0
                    }
                }))
            }
        };
        await fs.writeJSON(path.join(this.runDir, 'network.har'), har, { spaces: 2 });
    }
    async saveConsoleLogs(logs) {
        await fs.writeFile(path.join(this.runDir, 'console.log'), logs.join('\n'));
    }
    async copyVideo(sourcePath) {
        if (!sourcePath || !await fs.pathExists(sourcePath)) {
            return null;
        }
        const filename = path.basename(sourcePath);
        const destPath = path.join(this.runDir, 'videos', filename);
        await fs.copy(sourcePath, destPath);
        return destPath;
    }
    getRunDir() {
        return this.runDir;
    }
}
exports.ArtifactManager = ArtifactManager;
