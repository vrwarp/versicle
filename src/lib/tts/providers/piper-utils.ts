import { PiperProcessSupervisor } from './PiperProcessSupervisor';

let supervisor: PiperProcessSupervisor | undefined;

const getSupervisor = (workerUrl: string) => {
    if (!supervisor) {
        supervisor = new PiperProcessSupervisor(workerUrl);
    }
    return supervisor;
};

export const isModelCached = async (modelUrl: string): Promise<boolean> => {
  if (!supervisor) return false;

  try {
      return await supervisor.request({
          kind: 'isAlive',
          modelUrl
      });
  } catch (e) {
      return false;
  }
};

export const deleteCachedModel = (modelUrl: string, modelConfigUrl: string) => {
  if (supervisor) {
      supervisor.deleteCachedModel(modelUrl, modelConfigUrl);
  }
};

export const piperGenerate = async (
  piperPhonemizeJsUrl: string,
  piperPhonemizeWasmUrl: string,
  piperPhonemizeDataUrl: string,
  workerUrl: string,
  modelUrl: string,
  modelConfigUrl: string,
  speakerId: number | undefined,
  input: string,
  onProgress: (progress: number) => void,
  onnxruntimeUrl = "https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.17.1/"
): Promise<{ file: string; duration: number }> => {

  const sup = getSupervisor(workerUrl);

  const result = await sup.request({
      kind: "init",
      input,
      speakerId,
      // blobs is injected by supervisor
      piperPhonemizeJsUrl,
      piperPhonemizeWasmUrl,
      piperPhonemizeDataUrl,
      modelUrl,
      modelConfigUrl,
      onnxruntimeUrl,
  }, onProgress);

  const audioBlobUrl = URL.createObjectURL(result.file);
  return { file: audioBlobUrl, duration: result.duration };
};
