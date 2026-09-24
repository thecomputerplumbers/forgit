export default {
  fetch(request: Request, env: { FIXTURE_ORIGIN: string }) {
    const url = new URL(request.url);
    return fetch(new Request(`${env.FIXTURE_ORIGIN}${url.pathname}`, request));
  },
};
