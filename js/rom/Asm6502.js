class Asm6502 {
    static block(base, limit, labels = new Map()) {
        const bytes = [], references = [];
        const emit = (...values) => bytes.push(...values);
        const label = name => labels.set(name, base + bytes.length);
        function reference(opcode, destination, relative) {
            emit(opcode);
            references.push({at: bytes.length, destination, relative});
            if (relative) emit(0);
            else emit(0, 0);
        }
        function resolve() {
            if (base + bytes.length > limit) throw new Error('Code exceeds reserved bank space');
            for (const {at, destination, relative} of references) {
                const target = typeof destination === 'string' ? labels.get(destination) : destination;
                if (target === undefined) throw new Error('Unknown label: ' + destination);
                if (relative) {
                    const offset = target - (base + at + 1);
                    if (offset < -128 || offset > 127) throw new Error('Branch is out of range');
                    bytes[at] = offset & 255;
                } else {
                    bytes[at] = target & 255;
                    bytes[at + 1] = target >> 8;
                }
            }
        }
        return {base, limit, bytes, labels, emit, label, resolve,
            absolute: (op, target) => reference(op, target, false),
            branch: (op, target) => reference(op, target, true)};
    }

    // A program may span several reservations or banks. Resolve after all
    // sections have been emitted so forward references can cross sections.
    static program() {
        const labels = new Map(), blocks = [];
        let current;
        function section(base, limit) {
            current = Asm6502.block(base, limit, labels);
            blocks.push(current);
            return current;
        }
        return {labels, blocks, section,
            emit: (...bytes) => current.emit(...bytes),
            label: name => current.label(name),
            absolute: (op, target) => current.absolute(op, target),
            branch: (op, target) => current.branch(op, target),
            resolve: () => blocks.forEach(block => block.resolve())};
    }

    static writeBytes(data, insertAddr, codeArray){
        data.set(codeArray, insertAddr);
        return insertAddr + codeArray.length;
    }
}
