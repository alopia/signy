/**
 * The style elements applyStyles() added to a shadow root, so update() can
 * tell them from the ones a render made.
 *
 * @module component/applied-styles
 * @internal
 */

export const appliedStyles = new WeakSet<Node>();
