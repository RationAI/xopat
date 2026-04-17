/**
 * WeakMap implementation with weakly held values
 * @class InvertedWeakMap
 */
export class InvertedWeakMap<K, V extends object> {
    _map = new Map<K, WeakRef<V>>();
    _registry: FinalizationRegistry<any>;

    constructor() {
        this._registry = new FinalizationRegistry((key) => {
            this._map.delete(key)
        });
    }

    set(key: K, value: V) {
        this._map.set(key, new WeakRef(value))
        this._registry.register(value, key)
    }

    get(key: K): V | undefined {
        const ref = this._map.get(key)
        if (ref) {
            return ref.deref()
        }
    }

    has(key: K) {
        return this._map.has(key) && this.get(key) !== undefined
    }
}

/**
 * Queue
 * @class ClampedQueue
 */
export class ClampedQueue<T> {
    SIZE: number;
    _items: Record<number, T | undefined>;
    _i: number;

    constructor(size: number) {
        this.SIZE = size;
        this._items = {};
        this._i = 0;
    }

    /**
     * Add to queue
     */
    add(item: T): void {
        this._items[this._incr()] = item;
    }

    /**
     * Remove item that is present for the longest in queue
     */
    pop(): T | undefined {
        const item = this._items[this._i];
        delete this._items[this._i];
        this._decr();
        return item;
    }

    _incr(): number {
        return (this._i = (this._i + 1) % this.SIZE);
    }

    _decr(): number {
        return (this._i = this._i > 0 ? this._i - 1 : this.SIZE);
    }
}
