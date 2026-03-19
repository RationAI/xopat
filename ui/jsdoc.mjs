/**
 * Boolean-like visibility manager contract that other implementations can follow.
 *
 * Implementations manage a single "visible" flag for an identified resource
 * (such as a UI component) and provide ways to:
 *
 *  - Turn visibility on or off (`on`, `off`, `set`).
 *  - Query the current state (`is`).
 *  - Toggle the state (`toggle`).
 *  - Initialize how on/off affects the underlying resource (`init`).
 *
 * @template [TFlag=boolean]
 *   Type used to represent the visibility flag externally. For example
 *   {@link VisibilityManager} this is a simple boolean where `true` means
 *   "visible" and `false` means "hidden".
 *
 * @interface FlagManagerLike
 *
 * @property {string} id
 *   Identifier of the managed resource. Implementations SHOULD derive this
 *   from the component (or component-like) object they are bound to, or accept
 *   a plain string id.
 *
 * @property {function():void} on
 *   Make the resource visible. This MUST NOT change the persisted flag by
 *   itself; persisting should be handled via {@link FlagManagerLike#set}.
 *
 * @property {function():void} off
 *   Make the resource hidden. This MUST NOT change the persisted flag by
 *   itself; persisting should be handled via {@link FlagManagerLike#set}.
 *
 * @property {function(function():void, function():void, boolean=):void} init
 *   Initialize custom visibility behaviour using callbacks. After calling this,
 *   {@link FlagManagerLike#on} and {@link FlagManagerLike#off}
 *   MUST delegate to the provided callbacks. The `visibleNow` argument describes
 *   the current visibility at initialization time and MUST be reconciled with
 *   the persisted flag (see {@link FlagManagerLike#is}).
 *
 * @property {function(TFlag):void} set
 *   Persist and apply the visibility flag. Implementations MUST:
 *     - interpret the given `flag` value as "visible" or "hidden"
 *       according to their chosen `TFlag` (e.g. `true`/`false`),
 *     - call {@link FlagManagerLike#on} when the resulting state
 *       is "visible",
 *     - call {@link FlagManagerLike#off} when the resulting state
 *       is "hidden",
 *     - store the resulting state so that {@link FlagManagerLike#is}
 *       returns a corresponding value.
 *
 * @property {function():TFlag} is
 *   Return the currently persisted visibility flag. The returned `TFlag` value
 *   MUST be consistent with what was last passed to
 *   {@link FlagManagerLike#set}, or with the default visibility used
 *   during initialization when no explicit value has been set yet.
 *
 * @property {function():void} toggle
 *   Toggle the visibility state. Implementations MUST:
 *     - derive the current state from {@link FlagManagerLike#is},
 *     - switch it to the opposite state,
 *     - call {@link FlagManagerLike#set} with the new flag value
 *       so that the change is both applied and persisted.
 */