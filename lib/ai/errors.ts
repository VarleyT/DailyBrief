/**
 * The provider returned a response that cannot be consumed as a complete
 * model output, such as truncated or empty content.
 */
export class LlmIncompleteResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmIncompleteResponseError";
  }
}
