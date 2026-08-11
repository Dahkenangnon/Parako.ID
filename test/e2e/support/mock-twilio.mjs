import { registerHooks } from 'node:module';

const stubUrl = new URL('./twilio-client-stub.mjs', import.meta.url).href;

// This hook is loaded only by the disposable browser environment. Production
// continues to resolve and execute the official Twilio SDK unchanged.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'twilio') {
      return { format: 'module', shortCircuit: true, url: stubUrl };
    }

    return nextResolve(specifier, context);
  },
});
