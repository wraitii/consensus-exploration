export abstract class Data<T> {
    abstract isParent(child: T): boolean;
    abstract isSame(other: T): boolean;
}

export class Block extends Data<Block> {
    value = "";
    digest = "";
    parent: string = "";

    constructor(value: string, parent: Block | null) {
        super();
        this.value = value;
        if (parent) {
            this.parent = parent.digest;
            this.digest = value + parent.digest;
        }
    }

    isParent(child: Block): boolean {
        return child?.parent === this.digest;
    }

    isSame(other: Block): boolean {
        return other?.digest === this.digest;
    }
}
