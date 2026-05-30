declare module 'on-headers' {
  import type { ServerResponse } from 'node:http';

  function onHeaders(
    res: ServerResponse,
    listener: (this: ServerResponse) => void
  ): void;

  export = onHeaders;
}
