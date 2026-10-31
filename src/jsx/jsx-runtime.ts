/**
 * JSX Type Definitions for signy
 *
 * Provides complete TypeScript support for JSX syntax with signy.
 * Includes intrinsic elements (HTML/SVG), component props, and event types.
 *
 * @module jsx/jsx-runtime
 *
 * ## Usage
 *
 * In your tsconfig.json:
 * ```json
 * {
 *   "compilerOptions": {
 *     "jsx": "preserve",
 *     "jsxImportSource": "signy"
 *   }
 * }
 * ```
 *
 * Or at the top of individual files:
 * ```tsx
 * /** @jsxImportSource signy *\/
 * ```
 */

import type { Component } from '../component/component';
import type { Accessor } from './types';

//=============================================
// JSX Namespace
//=============================================

export namespace JSX {
  //=========================================
  // Core Element Types
  //=========================================

  /**
   * Result type of JSX expressions
   */
  export type Element = globalThis.Element | DocumentFragment | Text | Comment;

  /**
   * Array of elements (for fragments and mapped content)
   */
  export type ElementChildrenAttribute = { children: {} };

  /**
   * Valid children types in JSX
   */
  export type Child =
    Element | string | number | boolean | null | undefined | Child[];

  /**
   * Children can be static or reactive
   */
  export type Children = Child | Accessor<Child>;

  //=========================================
  // Event Handler Types
  //=========================================

  /**
   * Base event handler type
   */
  export type EventHandler<
    E extends Event = Event,
    T extends EventTarget = Element,
  > = (event: E & { currentTarget: T; target: EventTarget }) => void;

  /**
   * Bound event handler [handler, data]
   */
  export type BoundEventHandler<T, E extends Event = Event> = [
    (data: T, event: E) => void,
    T,
  ];

  /**
   * Event handler that accepts either direct or bound form
   */
  export type EventHandlerUnion<
    E extends Event = Event,
    T extends EventTarget = Element,
  > = EventHandler<E, T> | BoundEventHandler<unknown, E>;

  //=========================================
  // Common HTML Attributes
  //=========================================

  /**
   * Attributes common to all HTML elements
   */
  export interface HTMLAttributes<T extends EventTarget = HTMLElement> {
    // Core attributes
    accessKey?: string;
    class?: string | Record<string, boolean | undefined>;
    className?: string;
    classList?: Record<string, boolean | undefined>;
    contentEditable?: boolean | 'true' | 'false' | 'inherit';
    contextMenu?: string;
    dir?: 'ltr' | 'rtl' | 'auto';
    draggable?: boolean | 'true' | 'false';
    hidden?: boolean;
    id?: string;
    lang?: string;
    popover?: boolean | 'auto' | 'manual' | 'hint';
    slot?: string;
    spellCheck?: boolean | 'true' | 'false';
    style?: string | Record<string, string | number | null | undefined>;
    tabIndex?: number;
    title?: string;
    translate?: 'yes' | 'no';

    // ARIA attributes
    role?: string;

    // Data attributes
    [key: `data-${string}`]: string | number | boolean | undefined;

    // Ref
    ref?: ((el: T) => void) | { current: T | null };

    // Children
    children?: Children;

    // Mouse Events
    onClick?: EventHandlerUnion<MouseEvent, T>;
    onDblClick?: EventHandlerUnion<MouseEvent, T>;
    onMouseDown?: EventHandlerUnion<MouseEvent, T>;
    onMouseUp?: EventHandlerUnion<MouseEvent, T>;
    onMouseEnter?: EventHandlerUnion<MouseEvent, T>;
    onMouseLeave?: EventHandlerUnion<MouseEvent, T>;
    onMouseMove?: EventHandlerUnion<MouseEvent, T>;
    onMouseOver?: EventHandlerUnion<MouseEvent, T>;
    onMouseOut?: EventHandlerUnion<MouseEvent, T>;
    onContextMenu?: EventHandlerUnion<MouseEvent, T>;

    // Keyboard Events
    onKeyDown?: EventHandlerUnion<KeyboardEvent, T>;
    onKeyUp?: EventHandlerUnion<KeyboardEvent, T>;
    onKeyPress?: EventHandlerUnion<KeyboardEvent, T>;

    // Focus Events
    onFocus?: EventHandlerUnion<FocusEvent, T>;
    onBlur?: EventHandlerUnion<FocusEvent, T>;
    onFocusIn?: EventHandlerUnion<FocusEvent, T>;
    onFocusOut?: EventHandlerUnion<FocusEvent, T>;

    // Form Events
    onChange?: EventHandlerUnion<Event, T>;
    onInput?: EventHandlerUnion<InputEvent, T>;
    onSubmit?: EventHandlerUnion<SubmitEvent, T>;
    onReset?: EventHandlerUnion<Event, T>;
    onInvalid?: EventHandlerUnion<Event, T>;

    // Clipboard Events
    onCopy?: EventHandlerUnion<ClipboardEvent, T>;
    onCut?: EventHandlerUnion<ClipboardEvent, T>;
    onPaste?: EventHandlerUnion<ClipboardEvent, T>;

    // Drag Events
    onDrag?: EventHandlerUnion<DragEvent, T>;
    onDragEnd?: EventHandlerUnion<DragEvent, T>;
    onDragEnter?: EventHandlerUnion<DragEvent, T>;
    onDragLeave?: EventHandlerUnion<DragEvent, T>;
    onDragOver?: EventHandlerUnion<DragEvent, T>;
    onDragStart?: EventHandlerUnion<DragEvent, T>;
    onDrop?: EventHandlerUnion<DragEvent, T>;

    // Touch Events
    onTouchCancel?: EventHandlerUnion<TouchEvent, T>;
    onTouchEnd?: EventHandlerUnion<TouchEvent, T>;
    onTouchMove?: EventHandlerUnion<TouchEvent, T>;
    onTouchStart?: EventHandlerUnion<TouchEvent, T>;

    // Wheel Events
    onWheel?: EventHandlerUnion<WheelEvent, T>;

    // Scroll Events
    onScroll?: EventHandlerUnion<Event, T>;

    // Transition/Animation Events
    onTransitionEnd?: EventHandlerUnion<TransitionEvent, T>;
    onAnimationStart?: EventHandlerUnion<AnimationEvent, T>;
    onAnimationEnd?: EventHandlerUnion<AnimationEvent, T>;
    onAnimationIteration?: EventHandlerUnion<AnimationEvent, T>;

    // Other Events
    onLoad?: EventHandlerUnion<Event, T>;
    onError?: EventHandlerUnion<Event, T>;

    // Non-delegated events (use on:event syntax)
    [key: `on:${string}`]: EventHandler;
    [key: `oncapture:${string}`]: EventHandler;

    // Explicit property/attribute setting
    [key: `prop:${string}`]: unknown;
    [key: `attr:${string}`]: string | number | boolean | null | undefined;
    [key: `bool:${string}`]: unknown;
    [key: `class:${string}`]: boolean | undefined;
    [key: `style:${string}`]: string | number | null | undefined;

    // Directives: use:name={value} calls the in scope function `name`
    [key: `use:${string}`]: unknown;
  }

  //=========================================
  // Specific Element Attributes
  //=========================================

  export interface AnchorHTMLAttributes extends HTMLAttributes<HTMLAnchorElement> {
    download?: string | boolean;
    href?: string;
    hrefLang?: string;
    media?: string;
    ping?: string;
    rel?: string;
    target?: '_self' | '_blank' | '_parent' | '_top' | string;
    type?: string;
    referrerPolicy?: ReferrerPolicy;
  }

  export interface ButtonHTMLAttributes extends HTMLAttributes<HTMLButtonElement> {
    disabled?: boolean;
    form?: string;
    formAction?: string;
    formEncType?: string;
    formMethod?: string;
    formNoValidate?: boolean;
    formTarget?: string;
    name?: string;
    type?: 'submit' | 'reset' | 'button';
    value?: string | number;
    popovertarget?: string;
    popovertargetaction?: 'toggle' | 'show' | 'hide';
    command?: string;
    commandfor?: string;
  }

  export interface DialogHTMLAttributes extends HTMLAttributes<HTMLDialogElement> {
    open?: boolean;
    closedby?: 'any' | 'closerequest' | 'none';
  }

  export interface FormHTMLAttributes extends HTMLAttributes<HTMLFormElement> {
    acceptCharset?: string;
    action?: string;
    autoComplete?: string;
    encType?: string;
    method?: 'get' | 'post' | 'dialog';
    name?: string;
    noValidate?: boolean;
    target?: string;
  }

  export interface ImgHTMLAttributes extends HTMLAttributes<HTMLImageElement> {
    alt?: string;
    crossOrigin?: 'anonymous' | 'use-credentials' | '';
    decoding?: 'async' | 'auto' | 'sync';
    height?: number | string;
    loading?: 'eager' | 'lazy';
    referrerPolicy?: ReferrerPolicy;
    sizes?: string;
    src?: string;
    srcSet?: string;
    useMap?: string;
    width?: number | string;
  }

  export interface InputHTMLAttributes extends HTMLAttributes<HTMLInputElement> {
    accept?: string;
    alt?: string;
    autoComplete?: string;
    autoFocus?: boolean;
    capture?: boolean | 'user' | 'environment';
    checked?: boolean;
    disabled?: boolean;
    form?: string;
    formAction?: string;
    formEncType?: string;
    formMethod?: string;
    formNoValidate?: boolean;
    formTarget?: string;
    height?: number | string;
    list?: string;
    max?: number | string;
    maxLength?: number;
    min?: number | string;
    minLength?: number;
    multiple?: boolean;
    name?: string;
    pattern?: string;
    placeholder?: string;
    readOnly?: boolean;
    required?: boolean;
    size?: number;
    src?: string;
    step?: number | string;
    type?: string;
    value?: string | number;
    width?: number | string;
  }

  export interface LabelHTMLAttributes extends HTMLAttributes<HTMLLabelElement> {
    for?: string;
    htmlFor?: string;
    form?: string;
  }

  export interface OptionHTMLAttributes extends HTMLAttributes<HTMLOptionElement> {
    disabled?: boolean;
    label?: string;
    selected?: boolean;
    value?: string | number;
  }

  export interface SelectHTMLAttributes extends HTMLAttributes<HTMLSelectElement> {
    autoComplete?: string;
    autoFocus?: boolean;
    disabled?: boolean;
    form?: string;
    multiple?: boolean;
    name?: string;
    required?: boolean;
    size?: number;
    value?: string | number;
  }

  export interface SlotHTMLAttributes extends HTMLAttributes<HTMLSlotElement> {
    name?: string;
  }

  export interface TextareaHTMLAttributes extends HTMLAttributes<HTMLTextAreaElement> {
    autoComplete?: string;
    autoFocus?: boolean;
    cols?: number;
    disabled?: boolean;
    form?: string;
    maxLength?: number;
    minLength?: number;
    name?: string;
    placeholder?: string;
    readOnly?: boolean;
    required?: boolean;
    rows?: number;
    value?: string | number;
    wrap?: 'hard' | 'soft' | 'off';
  }

  export interface TableHTMLAttributes extends HTMLAttributes<HTMLTableElement> {
    cellPadding?: number | string;
    cellSpacing?: number | string;
    summary?: string;
  }

  export interface TdHTMLAttributes extends HTMLAttributes<HTMLTableCellElement> {
    colSpan?: number;
    headers?: string;
    rowSpan?: number;
  }

  export interface ThHTMLAttributes extends HTMLAttributes<HTMLTableCellElement> {
    colSpan?: number;
    headers?: string;
    rowSpan?: number;
    scope?: 'col' | 'row' | 'rowgroup' | 'colgroup';
  }

  export interface VideoHTMLAttributes extends HTMLAttributes<HTMLVideoElement> {
    autoPlay?: boolean;
    controls?: boolean;
    crossOrigin?: 'anonymous' | 'use-credentials' | '';
    height?: number | string;
    loop?: boolean;
    muted?: boolean;
    playsInline?: boolean;
    poster?: string;
    preload?: 'none' | 'metadata' | 'auto' | '';
    src?: string;
    width?: number | string;
  }

  export interface AudioHTMLAttributes extends HTMLAttributes<HTMLAudioElement> {
    autoPlay?: boolean;
    controls?: boolean;
    crossOrigin?: 'anonymous' | 'use-credentials' | '';
    loop?: boolean;
    muted?: boolean;
    preload?: 'none' | 'metadata' | 'auto' | '';
    src?: string;
  }

  //=========================================
  // SVG Attributes
  //=========================================

  export interface SVGAttributes<
    T extends SVGElement = SVGElement,
  > extends HTMLAttributes<T> {
    // SVG-specific attributes
    viewBox?: string;
    xmlns?: string;
    href?: string;
    'xlink:href'?: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number | string;
    d?: string;
    cx?: number | string;
    cy?: number | string;
    r?: number | string;
    rx?: number | string;
    ry?: number | string;
    x?: number | string;
    y?: number | string;
    x1?: number | string;
    y1?: number | string;
    x2?: number | string;
    y2?: number | string;
    width?: number | string;
    height?: number | string;
    transform?: string;
    pathLength?: number;
    points?: string;
    preserveAspectRatio?: string;
  }

  //=========================================
  // Intrinsic Elements
  //=========================================

  /** MathML elements, from the DOM types. `a` stays the HTML one. */
  export type MathMLElements = {
    [
      K in Exclude<keyof MathMLElementTagNameMap, keyof HTMLElementTagNameMap>
    ]: HTMLAttributes<MathMLElementTagNameMap[K]>;
  };

  export interface IntrinsicElements extends MathMLElements {
    // HTML Elements
    a: AnchorHTMLAttributes;
    abbr: HTMLAttributes;
    address: HTMLAttributes;
    area: HTMLAttributes<HTMLAreaElement>;
    article: HTMLAttributes;
    aside: HTMLAttributes;
    audio: AudioHTMLAttributes;
    b: HTMLAttributes;
    base: HTMLAttributes<HTMLBaseElement>;
    bdi: HTMLAttributes;
    bdo: HTMLAttributes;
    blockquote: HTMLAttributes<HTMLQuoteElement>;
    body: HTMLAttributes<HTMLBodyElement>;
    br: HTMLAttributes<HTMLBRElement>;
    button: ButtonHTMLAttributes;
    canvas: HTMLAttributes<HTMLCanvasElement>;
    caption: HTMLAttributes;
    cite: HTMLAttributes;
    code: HTMLAttributes;
    col: HTMLAttributes<HTMLTableColElement>;
    colgroup: HTMLAttributes<HTMLTableColElement>;
    data: HTMLAttributes<HTMLDataElement>;
    datalist: HTMLAttributes<HTMLDataListElement>;
    dd: HTMLAttributes;
    del: HTMLAttributes<HTMLModElement>;
    details: HTMLAttributes<HTMLDetailsElement>;
    dfn: HTMLAttributes;
    dialog: DialogHTMLAttributes;
    div: HTMLAttributes<HTMLDivElement>;
    dl: HTMLAttributes<HTMLDListElement>;
    dt: HTMLAttributes;
    em: HTMLAttributes;
    embed: HTMLAttributes<HTMLEmbedElement>;
    fieldset: HTMLAttributes<HTMLFieldSetElement>;
    figcaption: HTMLAttributes;
    figure: HTMLAttributes;
    footer: HTMLAttributes;
    form: FormHTMLAttributes;
    h1: HTMLAttributes<HTMLHeadingElement>;
    h2: HTMLAttributes<HTMLHeadingElement>;
    h3: HTMLAttributes<HTMLHeadingElement>;
    h4: HTMLAttributes<HTMLHeadingElement>;
    h5: HTMLAttributes<HTMLHeadingElement>;
    h6: HTMLAttributes<HTMLHeadingElement>;
    head: HTMLAttributes<HTMLHeadElement>;
    header: HTMLAttributes;
    hgroup: HTMLAttributes;
    hr: HTMLAttributes<HTMLHRElement>;
    html: HTMLAttributes<HTMLHtmlElement>;
    i: HTMLAttributes;
    iframe: HTMLAttributes<HTMLIFrameElement>;
    img: ImgHTMLAttributes;
    input: InputHTMLAttributes;
    ins: HTMLAttributes<HTMLModElement>;
    kbd: HTMLAttributes;
    label: LabelHTMLAttributes;
    legend: HTMLAttributes<HTMLLegendElement>;
    li: HTMLAttributes<HTMLLIElement>;
    link: HTMLAttributes<HTMLLinkElement>;
    main: HTMLAttributes;
    map: HTMLAttributes<HTMLMapElement>;
    mark: HTMLAttributes;
    menu: HTMLAttributes<HTMLMenuElement>;
    meta: HTMLAttributes<HTMLMetaElement>;
    meter: HTMLAttributes<HTMLMeterElement>;
    nav: HTMLAttributes;
    noscript: HTMLAttributes;
    object: HTMLAttributes<HTMLObjectElement>;
    ol: HTMLAttributes<HTMLOListElement>;
    optgroup: HTMLAttributes<HTMLOptGroupElement>;
    option: OptionHTMLAttributes;
    output: HTMLAttributes<HTMLOutputElement>;
    p: HTMLAttributes<HTMLParagraphElement>;
    picture: HTMLAttributes<HTMLPictureElement>;
    pre: HTMLAttributes<HTMLPreElement>;
    progress: HTMLAttributes<HTMLProgressElement>;
    q: HTMLAttributes<HTMLQuoteElement>;
    rp: HTMLAttributes;
    rt: HTMLAttributes;
    ruby: HTMLAttributes;
    s: HTMLAttributes;
    samp: HTMLAttributes;
    script: HTMLAttributes<HTMLScriptElement>;
    section: HTMLAttributes;
    select: SelectHTMLAttributes;
    slot: SlotHTMLAttributes;
    small: HTMLAttributes;
    source: HTMLAttributes<HTMLSourceElement>;
    span: HTMLAttributes<HTMLSpanElement>;
    strong: HTMLAttributes;
    style: HTMLAttributes<HTMLStyleElement>;
    sub: HTMLAttributes;
    summary: HTMLAttributes;
    sup: HTMLAttributes;
    table: TableHTMLAttributes;
    tbody: HTMLAttributes<HTMLTableSectionElement>;
    td: TdHTMLAttributes;
    template: HTMLAttributes<HTMLTemplateElement>;
    textarea: TextareaHTMLAttributes;
    tfoot: HTMLAttributes<HTMLTableSectionElement>;
    th: ThHTMLAttributes;
    thead: HTMLAttributes<HTMLTableSectionElement>;
    time: HTMLAttributes<HTMLTimeElement>;
    title: HTMLAttributes<HTMLTitleElement>;
    tr: HTMLAttributes<HTMLTableRowElement>;
    track: HTMLAttributes<HTMLTrackElement>;
    u: HTMLAttributes;
    ul: HTMLAttributes<HTMLUListElement>;
    var: HTMLAttributes;
    video: VideoHTMLAttributes;
    wbr: HTMLAttributes;

    // SVG Elements
    svg: SVGAttributes<SVGSVGElement>;
    circle: SVGAttributes<SVGCircleElement>;
    clipPath: SVGAttributes;
    defs: SVGAttributes<SVGDefsElement>;
    ellipse: SVGAttributes<SVGEllipseElement>;
    g: SVGAttributes<SVGGElement>;
    image: SVGAttributes<SVGImageElement>;
    line: SVGAttributes<SVGLineElement>;
    linearGradient: SVGAttributes<SVGLinearGradientElement>;
    mask: SVGAttributes<SVGMaskElement>;
    path: SVGAttributes<SVGPathElement>;
    pattern: SVGAttributes<SVGPatternElement>;
    polygon: SVGAttributes<SVGPolygonElement>;
    polyline: SVGAttributes<SVGPolylineElement>;
    radialGradient: SVGAttributes<SVGRadialGradientElement>;
    rect: SVGAttributes<SVGRectElement>;
    stop: SVGAttributes<SVGStopElement>;
    symbol: SVGAttributes<SVGSymbolElement>;
    text: SVGAttributes<SVGTextElement>;
    textPath: SVGAttributes<SVGTextPathElement>;
    tspan: SVGAttributes<SVGTSpanElement>;
    use: SVGAttributes<SVGUseElement>;
  }

  //=========================================
  // Component Types
  //=========================================

  /**
   * For function components
   */
  export interface FunctionElement<P = Record<string, unknown>> {
    (props: P): Element;
  }

  /**
   * For class components
   */
  export type ComponentElement<P = Record<string, unknown>> = new (
    props: P
  ) => Component;
}

//=============================================
// Export Fragment for JSX
//=============================================

export { Fragment } from '../views/hyperscript';

//=============================================
// JSX Factory (for completeness)
//=============================================

/**
 * JSX factory function - used by some JSX transforms.
 * Note: babel-plugin-jsx-dom-expressions doesn't use this directly,
 * but it's provided for compatibility.
 */
export function jsx(
  _type: string | ((props: Record<string, unknown>) => JSX.Element),
  _props: Record<string, unknown>
): JSX.Element {
  // This is a placeholder - the actual JSX transform uses
  // template(), insert(), createComponent() etc.
  throw new Error(
    'jsx() should not be called directly. ' +
      'Configure babel-plugin-jsx-dom-expressions to use signy/jsx runtime.'
  );
}

export { jsx as jsxs, jsx as jsxDEV };
