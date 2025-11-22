export interface ArtifactPaths {
    runDir: string;
    tracingPath: string;
    videoPath: string | null;
    reportPath: string;
    harPath: string;
    logsPath: string;
}
export declare class ArtifactManager {
    private runDir;
    constructor(runId: string);
    initialize(): Promise<ArtifactPaths>;
    saveNetworkHAR(networkEntries: any[]): Promise<void>;
    saveConsoleLogs(logs: string[]): Promise<void>;
    copyVideo(sourcePath: string | null): Promise<string | null>;
    getRunDir(): string;
}
