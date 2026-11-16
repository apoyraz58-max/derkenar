declare module "citeproc" {
  const CSL: unknown;
  export default CSL;
}
declare module "@citation-js/core" {
  export class Cite {
    static async(data: unknown, options?: Record<string, unknown>): Promise<Cite>;
    data: unknown[];
    format(format: string, options?: Record<string, unknown>): string;
  }
  export const plugins: { input: { list(): string[] } };
}
declare module "@citation-js/plugin-bibtex";
declare module "@citation-js/plugin-ris";
