---
applyTo: '**/*.ts'
---

# TypeScript class member ordering

The order of members inside a TypeScript class in Signy.

**IMPORTANT:** These rules apply ONLY to TypeScript classes. Do not apply to interfaces, type definitions, or non-class code.

## Ordering rules

Follow this order for all TypeScript class members:

### 1. Static members
- Static fields (readonly before mutable)
- Static methods
- Group related static members together

```typescript
class Component {
  private static readonly _DEFAULT_OPTIONS: Options = {};
  private static _instanceCounters = new Map<string, number>();
  
  static create(options: Options): Component {
    return new Component(options);
  }
}
```

### 2. Public instance fields
- Readonly fields first
- Then mutable fields
- Order by importance/usage frequency

```typescript
class Component {
  readonly id: string;
  name: string = '';
}
```

### 3. Protected instance fields
- Readonly fields first
- Then mutable fields

```typescript
class Component {
  protected readonly options: ComponentOptions;
  protected status: Status = Status.CREATED;
}
```

### 4. Private instance fields
- Backing fields for getters/setters
- Then other private fields, all with the `_` prefix
- Readonly before mutable

```typescript
class Component {
  private _enabled: boolean = false;
  private readonly _config: Config;
  private _container: HTMLElement | null = null;
}
```

### 5. Constructor
- Single constructor (TypeScript doesn't support overloading)
- Initialize fields that need constructor parameters

```typescript
class Component {
  constructor(options: ComponentOptions) {
    this.id = options.id;
    this._config = { ...DEFAULT_CONFIG, ...options };
  }
}
```

### 6. Getters and setters
- Keep getter and setter for the same property together
- Getter before setter
- Group related getters/setters
- Order by importance or logical usage flow

```typescript
class Component {
  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    this._enabled = value;
  }

  get isMounted(): boolean {
    return this.status === Status.MOUNTED;
  }

  get isActive(): boolean {
    return this.status === Status.ACTIVE;
  }
}
```

### 7. Public methods
- Order by typical usage flow (lifecycle order if applicable)
- Related methods together
- Most important/frequently used first

```typescript
class Component {
  mount(target: ElementOrSelector): this {
    // ...
    return this;
  }

  render(): string {
    // ...
    return '';
  }

  update(data: unknown): this {
    // ...
    return this;
  }

  unmount(): this {
    // ...
    return this;
  }
}
```

### 8. Protected methods
- Order by when they're called in the lifecycle
- Or alphabetically if no clear order

```typescript
class Component {
  protected initialize(): void {
    // ...
  }

  protected updateStatus(status: Status): void {
    this.status = status;
  }
}
```

### 9. Private methods
- Order by when they're called
- Helper methods near where they're used
- Or alphabetically if no clear order

```typescript
class Component {
  private _cleanup(): void {
    // ...
  }

  private _initializeContainer(target: ElementOrSelector): void {
    // ...
  }

  private _validateOptions(options: ComponentOptions): void {
    // ...
  }
}
```

## Additional guidelines

### Abstract members
- Place abstract methods/properties before concrete implementations
- Follow the same visibility ordering

```typescript
abstract class BaseComponent {
  // Abstract members first
  protected abstract render(): string;
  
  // Then concrete members
  protected status: Status = Status.CREATED;
  
  mount(): this {
    const html = this.render();
    // ...
    return this;
  }
}
```

### Lifecycle methods
- When applicable, follow lifecycle order (init → update → destroy)
- Common lifecycle patterns:
  - `constructor` → `mount` → `update` → `unmount`
  - `initialize` → `start` → `stop` → `cleanup`

```typescript
class Application {
  mount(target: ElementOrSelector): this { }
  start(): this { }
  update(): void { }
  stop(): this { }
  unmount(): this { }
}
```

### Related methods grouping
- Keep methods that work together close to each other
- Add blank lines between logical groups

```typescript
class Component {
  // Rendering group
  render(): string { }
  protected compileTemplate(): string { }
  private _sanitizeHtml(html: string): string { }

  // Event handling group
  addEventListener(event: string, handler: Function): void { }
  removeEventListener(event: string, handler: Function): void { }
  private _handleEvent(event: Event): void { }
}
```

### Section separators

Longer classes in `src/` split the groups with a short separator, as the complete example below shows. Match the file: use them where the file already does, do not add them to a file that has none.

```typescript
  //=============================================
  // Public methods
  //=============================================
```

### Visibility markers
- Always mark `protected` and `private` explicitly
- Mark `public` when mixing visibilities for clarity
- Omit `public` when all members are public

```typescript
class Component {
  // Explicit when mixed visibility
  public mount(): this { }
  protected initialize(): void { }
  private _cleanup(): void { }
}

class SimpleComponent {
  // Omit public when all members are public
  mount(): this { }
  render(): string { }
}
```

## Complete example

```typescript
class Component {
  // 1. Static members
  private static readonly _DEFAULT_OPTIONS: ComponentOptions = {};
  private static _instanceCounter = 0;

  static create(options: ComponentOptions): Component {
    return new Component(options);
  }

  // 2. Public instance fields
  readonly id: string;

  // 3. Protected instance fields
  protected status: Status = Status.CREATED;

  // 4. Private instance fields
  private _enabled: boolean = false;
  private readonly _options: ComponentOptions;
  private _container: HTMLElement | null = null;

  // 5. Constructor
  constructor(options: ComponentOptions) {
    this.id = `component-${++Component._instanceCounter}`;
    this._options = { ...Component._DEFAULT_OPTIONS, ...options };
  }

  //=============================================
  // Getters and setters
  //=============================================

  // 6. Getters and setters
  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    this._enabled = value;
  }

  get isMounted(): boolean {
    return this.status === Status.MOUNTED;
  }

  //=============================================
  // Public methods
  //=============================================

  // 7. Public methods
  mount(target: ElementOrSelector): this {
    this.initialize();
    this._attachToDOM(target);
    return this;
  }

  render(): string {
    return this._compileTemplate();
  }

  unmount(): this {
    this._cleanup();
    return this;
  }

  //=============================================
  // Protected methods
  //=============================================

  // 8. Protected methods
  protected initialize(): void {
    this.updateStatus(Status.INITIALIZING);
  }

  protected updateStatus(status: Status): void {
    this.status = status;
  }

  //=============================================
  // Private methods
  //=============================================

  // 9. Private methods
  private _attachToDOM(target: ElementOrSelector): void {
    // ...
  }

  private _compileTemplate(): string {
    // ...
    return '';
  }

  private _cleanup(): void {
    this._container = null;
  }
}
```

## When to deviate

These rules can be broken when:
- A specific logical grouping makes more sense for the class's purpose
- Framework-specific patterns require different ordering
- The class has a unique structure that benefits from alternative ordering

However, always maintain consistency within the same file and similar classes.
