/**
 * FakePiperRuntime — a deterministic in-memory stand-in for {@link PiperRuntime}.
 *
 * Injected into `PiperProvider` by its unit suite and the provider contract
 * harness (vi.mock is banned in providers/): records every generate request,
 * models the durable store as a Map, and lets tests arm failures and seed an
 * offline model inventory. Use {@link FakePiperRuntime.asRuntime} to satisfy the
 * (structurally private) `PiperRuntime` constructor parameter.
 */
import type { PiperRuntime, PiperGenerateRequest, PiperGenerateResult } from './PiperRuntime';

/** A minimal RIFF/WAVE header — enough for stitchWavs and blob-type assertions. */
export function tinyWavBlob(): Blob {
    const wavHeader = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
        0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
        0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
        0x44, 0xac, 0x00, 0x00, 0x88, 0x58, 0x01, 0x00,
        0x02, 0x00, 0x10, 0x00, 0x64, 0x61, 0x74, 0x61,
        0x00, 0x00, 0x00, 0x00
    ]);
    return new Blob([wavHeader], { type: 'audio/wav' });
}

export class FakePiperRuntime {
    /** Every generate() request, in order. */
    readonly generated: PiperGenerateRequest[] = [];
    /** Durable-store double (url → blob). */
    readonly savedModels = new Map<string, Blob>();
    /** deleteModel calls as [modelUrl, configUrl] pairs. */
    readonly deletedModels: Array<[string, string]> = [];
    /** Serve this as the cached voices.json (SWR path); null = cold cache. */
    catalogJson: unknown | null = null;
    /** Extra model URLs reported as downloaded (offline enumeration). */
    downloadedModelUrls: string[] = [];
    /** Arm the next generate() to reject. */
    failNextGenerate: Error | null = null;
    disposed = false;

    async cacheMatch(url: string): Promise<Response | null> {
        if (url.endsWith('voices.json')) {
            return this.catalogJson === null
                ? null
                : new Response(JSON.stringify(this.catalogJson), { headers: { 'Content-Type': 'application/json' } });
        }
        const blob = this.savedModels.get(url);
        return blob ? new Response(blob) : null;
    }

    async cachePut(url: string, body: Blob | Response): Promise<void> {
        if (url.endsWith('voices.json')) {
            const text = body instanceof Response ? await body.text() : await body.text();
            this.catalogJson = JSON.parse(text);
            return;
        }
        this.savedModels.set(url, body instanceof Response ? await body.blob() : body);
    }

    async isModelDownloaded(modelUrl: string): Promise<boolean> {
        return this.savedModels.has(modelUrl) || this.downloadedModelUrls.includes(modelUrl);
    }

    async saveModel(url: string, blob: Blob): Promise<void> {
        this.savedModels.set(url, blob);
    }

    async deleteModel(modelUrl: string, configUrl: string): Promise<void> {
        this.deletedModels.push([modelUrl, configUrl]);
        this.savedModels.delete(modelUrl);
        this.savedModels.delete(configUrl);
        this.downloadedModelUrls = this.downloadedModelUrls.filter((u) => u !== modelUrl);
    }

    async listDownloadedModelUrls(): Promise<string[]> {
        return [
            ...this.downloadedModelUrls,
            ...[...this.savedModels.keys()].filter((u) => u.endsWith('.onnx')),
        ];
    }

    async generate(req: PiperGenerateRequest): Promise<PiperGenerateResult> {
        if (this.disposed) throw new Error('PiperRuntime is disposed');
        this.generated.push(req);
        const failure = this.failNextGenerate;
        if (failure) {
            this.failNextGenerate = null;
            throw failure;
        }
        req.onProgress?.(100);
        return { file: tinyWavBlob(), duration: 100 };
    }

    dispose(): void {
        this.disposed = true;
    }

    /** Structural cast for the `PiperRuntime`-typed constructor parameter. */
    asRuntime(): PiperRuntime {
        return this as unknown as PiperRuntime;
    }
}
