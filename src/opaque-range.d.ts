// Chrome 152 API, not yet included in TypeScript's DOM definitions.
// OpaqueRange extends AbstractRange; it is created by the form control,
// never by constructing a DOM Range or reading the textarea's shadow DOM.
interface OpaqueRange extends AbstractRange {}
interface HTMLTextAreaElement {
  createValueRange(start: number, end: number): OpaqueRange;
}
