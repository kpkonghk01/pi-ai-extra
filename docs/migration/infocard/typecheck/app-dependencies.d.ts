// Stand-ins for InfoCard's own dependencies, which are not installed in this repository.
// They only need to cover what files/ uses; the real types apply inside the app.

declare module "express" {
  const express: any;
  export default express;
}

declare module "vite" {
  export const createServer: (options?: unknown) => Promise<any>;
  export const defineConfig: (config: unknown) => unknown;
}

declare module "@vitejs/plugin-react" {
  const react: () => unknown;
  export default react;
}

declare module "@tailwindcss/vite" {
  const tailwindcss: () => unknown;
  export default tailwindcss;
}

declare module "@google/genai" {
  export class GoogleGenAI {
    constructor(options: { apiKey: string; httpOptions?: unknown });
    models: any;
  }
}

declare module "dotenv" {
  const dotenv: { config: () => unknown };
  export default dotenv;
}

declare module "opencc-js" {
  export const Converter: (options: { from: string; to: string }) => (text: string) => string;
}

declare module "sharp" {
  const sharp: any;
  export default sharp;
}

declare module "idb-keyval" {
  export function get<T = any>(key: string): Promise<T | undefined>;
  export function set(key: string, value: unknown): Promise<void>;
}

declare module "date-fns" {
  export function format(date: number | Date, pattern: string): string;
}

declare module "react-dom/client" {
  export function createRoot(container: Element): { render(node: unknown): void };
}

declare module "lucide-react" {
  export const X: (props: { className?: string }) => any;
}

declare module "*.css";
