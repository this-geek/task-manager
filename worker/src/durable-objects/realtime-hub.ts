/**
 * Single global hub (spec §8.2) that fans out task state-transition events
 * to every connected SSE client. A Durable Object is the natural fit here
 * since a Worker has no persistent memory across requests to hold open
 * connections in.
 */
export class RealtimeHub {
  private writers = new Set<WritableStreamDefaultWriter<Uint8Array>>();

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/subscribe') {
      const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
      const writer = writable.getWriter();
      this.writers.add(writer);

      // Don't await: a writer's write() only resolves once a reader actually
      // pulls, which hasn't happened yet since the Response below hasn't
      // even reached the client. Awaiting here would deadlock the handler.
      writer.write(new TextEncoder().encode(': connected\n\n')).catch(() => this.writers.delete(writer));

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    if (url.pathname === '/broadcast' && request.method === 'POST') {
      const payload = await request.text();
      const chunk = new TextEncoder().encode(`data: ${payload}\n\n`);

      // Same reasoning: fire-and-forget so one slow/dead subscriber can't
      // block every future broadcast.
      for (const writer of this.writers) {
        writer.write(chunk).catch(() => this.writers.delete(writer));
      }

      return new Response('ok');
    }

    return new Response('not found', { status: 404 });
  }
}
