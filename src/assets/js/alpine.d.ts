declare module 'alpinejs' {
  interface AlpineApi {
    start(): void;
    data(name: string, callback: (...args: unknown[]) => unknown): void;
    store(name: string, value: unknown): void;
  }

  const Alpine: AlpineApi;
  export default Alpine;
}
