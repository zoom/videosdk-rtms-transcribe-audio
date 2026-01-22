declare module "whisper-node" {
  export function whisper(
    filePath: string,
    options: any,
  ): Promise<SampleTranscript>;
  export default whisper;
}
