// Minimal SoundFont 2 / SF3 reader and single-preset writer. Splits a bank
// into one small file per preset ("instrument pack") without re-encoding:
// SF3 samples are independent Ogg Vorbis streams addressed by byte range, so
// a pack copies the bytes and rebases the ranges. Loop points in SF3 are
// relative to the sample, so they carry over unchanged.

const SAMPLE_TYPE_MONO = 1;
const SAMPLE_TYPE_RIGHT = 2;
const SAMPLE_TYPE_LEFT = 4;
const GEN_INSTRUMENT = 41;
const GEN_SAMPLE_ID = 53;

const RECORDS = {
	phdr: 38,
	pbag: 4,
	pmod: 10,
	pgen: 4,
	inst: 22,
	ibag: 4,
	imod: 10,
	igen: 4,
	shdr: 46
};

function* chunks(buf, start, end) {
	let off = start;
	while (off + 8 <= end) {
		const id = buf.toString('latin1', off, off + 4);
		const size = buf.readUInt32LE(off + 4);
		yield { id, start: off + 8, size };
		off += 8 + size + (size & 1);
	}
}

function split(buf, size) {
	const out = [];
	for (let i = 0; i + size <= buf.length; i += size) out.push(buf.subarray(i, i + size));
	return out;
}

/** Parse a SoundFont into raw records. Keeps the INFO list verbatim (credits). */
export function readSoundFont(buf) {
	if (buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'sfbk')
		throw new Error('Not a SoundFont');
	const sf = { info: null, smpl: null, pdta: {} };
	for (const c of chunks(buf, 12, buf.length)) {
		if (c.id !== 'LIST') continue;
		const kind = buf.toString('latin1', c.start, c.start + 4);
		if (kind === 'INFO') sf.info = buf.subarray(c.start - 8, c.start + c.size);
		for (const sub of chunks(buf, c.start + 4, c.start + c.size)) {
			const body = buf.subarray(sub.start, sub.start + sub.size);
			if (kind === 'sdta' && sub.id === 'smpl') sf.smpl = body;
			if (kind === 'pdta') sf.pdta[sub.id] = split(body, RECORDS[sub.id]);
		}
	}
	for (const id of Object.keys(RECORDS)) if (!sf.pdta[id]) throw new Error(`Missing ${id}`);
	return sf;
}

export function presetList(sf) {
	const { phdr } = sf.pdta;
	return phdr.slice(0, -1).map((r, index) => ({
		index,
		name: r.toString('latin1', 0, 20).replace(/\0.*$/s, ''),
		program: r.readUInt16LE(20),
		bank: r.readUInt16LE(22)
	}));
}

/** Sample indexes reached by a preset, and whether any of them is not mono. */
export function presetSamples(sf, presetIndex) {
	const { phdr, pbag, pgen, inst, ibag, igen, shdr } = sf.pdta;
	const samples = new Set();
	const bagRange = (recs, i, at) => [recs[i].readUInt16LE(at), recs[i + 1].readUInt16LE(at)];
	const [pb0, pb1] = bagRange(phdr, presetIndex, 24);
	for (let b = pb0; b < pb1; b++) {
		const [g0, g1] = bagRange(pbag, b, 0);
		for (let g = g0; g < g1; g++) {
			if (pgen[g].readUInt16LE(0) !== GEN_INSTRUMENT) continue;
			const i = pgen[g].readUInt16LE(2);
			const [ib0, ib1] = bagRange(inst, i, 20);
			for (let bb = ib0; bb < ib1; bb++) {
				const [gg0, gg1] = bagRange(ibag, bb, 0);
				for (let gg = gg0; gg < gg1; gg++)
					if (igen[gg].readUInt16LE(0) === GEN_SAMPLE_ID) samples.add(igen[gg].readUInt16LE(2));
			}
		}
	}
	let bytes = 0;
	let stereo = 0;
	for (const s of samples) {
		bytes += shdr[s].readUInt32LE(24) - shdr[s].readUInt32LE(20);
		if (shdr[s].readUInt16LE(44) & (SAMPLE_TYPE_LEFT | SAMPLE_TYPE_RIGHT)) stereo++;
	}
	return { samples: [...samples].sort((a, b) => a - b), bytes, stereo };
}

function chunk(id, body) {
	const head = Buffer.alloc(8);
	head.write(id, 0, 'latin1');
	head.writeUInt32LE(body.length, 4);
	return Buffer.concat(body.length & 1 ? [head, body, Buffer.alloc(1)] : [head, body]);
}

function list(kind, parts) {
	return chunk('LIST', Buffer.concat([Buffer.from(kind, 'latin1'), ...parts]));
}

function terminal(size, name) {
	const r = Buffer.alloc(size);
	if (name) r.write(name, 0, 'latin1');
	return r;
}

/**
 * Write a SoundFont holding only `presetIndex` and what it references.
 * Linked stereo samples are marked mono: each side keeps its own zone and pan,
 * so the stereo image survives in synths that only play mono samples.
 */
export function writePresetPack(sf, presetIndex, { bank, program, stereoAsMono = true } = {}) {
	const { phdr, pbag, pmod, pgen, inst, ibag, imod, igen, shdr } = sf.pdta;
	const out = {
		phdr: [],
		pbag: [],
		pmod: [],
		pgen: [],
		inst: [],
		ibag: [],
		imod: [],
		igen: [],
		shdr: []
	};
	const instMap = new Map();
	const sampleMap = new Map();
	const smplParts = [];
	let smplOffset = 0;

	const addSample = (s) => {
		if (sampleMap.has(s)) return sampleMap.get(s);
		const r = Buffer.from(shdr[s]);
		const start = r.readUInt32LE(20);
		const end = r.readUInt32LE(24);
		const bytes = sf.smpl.subarray(start, end);
		r.writeUInt32LE(smplOffset, 20);
		r.writeUInt32LE(smplOffset + bytes.length, 24);
		const type = r.readUInt16LE(44);
		if (stereoAsMono && type & (SAMPLE_TYPE_LEFT | SAMPLE_TYPE_RIGHT))
			r.writeUInt16LE((type & ~(SAMPLE_TYPE_LEFT | SAMPLE_TYPE_RIGHT)) | SAMPLE_TYPE_MONO, 44);
		if (stereoAsMono) r.writeUInt16LE(0, 42); // no sample link
		smplParts.push(bytes);
		smplOffset += bytes.length;
		const index = out.shdr.length;
		out.shdr.push(r);
		sampleMap.set(s, index);
		return index;
	};

	const addInstrument = (i) => {
		if (instMap.has(i)) return instMap.get(i);
		const index = out.inst.length;
		instMap.set(i, index);
		const r = Buffer.from(inst[i]);
		r.writeUInt16LE(out.ibag.length, 20);
		out.inst.push(r);
		for (let b = inst[i].readUInt16LE(20); b < inst[i + 1].readUInt16LE(20); b++) {
			const bag = Buffer.alloc(4);
			bag.writeUInt16LE(out.igen.length, 0);
			bag.writeUInt16LE(out.imod.length, 2);
			out.ibag.push(bag);
			for (let m = ibag[b].readUInt16LE(2); m < ibag[b + 1].readUInt16LE(2); m++)
				out.imod.push(Buffer.from(imod[m]));
			for (let g = ibag[b].readUInt16LE(0); g < ibag[b + 1].readUInt16LE(0); g++) {
				const gen = Buffer.from(igen[g]);
				if (gen.readUInt16LE(0) === GEN_SAMPLE_ID)
					gen.writeUInt16LE(addSample(gen.readUInt16LE(2)), 2);
				out.igen.push(gen);
			}
		}
		return index;
	};

	const head = Buffer.from(phdr[presetIndex]);
	if (program !== undefined) head.writeUInt16LE(program, 20);
	if (bank !== undefined) head.writeUInt16LE(bank, 22);
	head.writeUInt16LE(0, 24);
	out.phdr.push(head);
	for (
		let b = phdr[presetIndex].readUInt16LE(24);
		b < phdr[presetIndex + 1].readUInt16LE(24);
		b++
	) {
		const bag = Buffer.alloc(4);
		bag.writeUInt16LE(out.pgen.length, 0);
		bag.writeUInt16LE(out.pmod.length, 2);
		out.pbag.push(bag);
		for (let m = pbag[b].readUInt16LE(2); m < pbag[b + 1].readUInt16LE(2); m++)
			out.pmod.push(Buffer.from(pmod[m]));
		for (let g = pbag[b].readUInt16LE(0); g < pbag[b + 1].readUInt16LE(0); g++) {
			const gen = Buffer.from(pgen[g]);
			if (gen.readUInt16LE(0) === GEN_INSTRUMENT)
				gen.writeUInt16LE(addInstrument(gen.readUInt16LE(2)), 2);
			out.pgen.push(gen);
		}
	}

	// Terminal records, as the format requires
	const eop = terminal(RECORDS.phdr, 'EOP');
	eop.writeUInt16LE(out.pbag.length, 24);
	out.phdr.push(eop);
	const endPbag = Buffer.alloc(4);
	endPbag.writeUInt16LE(out.pgen.length, 0);
	endPbag.writeUInt16LE(out.pmod.length, 2);
	out.pbag.push(endPbag);
	out.pmod.push(terminal(RECORDS.pmod));
	out.pgen.push(terminal(RECORDS.pgen));
	const eoi = terminal(RECORDS.inst, 'EOI');
	eoi.writeUInt16LE(out.ibag.length, 20);
	out.inst.push(eoi);
	const endIbag = Buffer.alloc(4);
	endIbag.writeUInt16LE(out.igen.length, 0);
	endIbag.writeUInt16LE(out.imod.length, 2);
	out.ibag.push(endIbag);
	out.imod.push(terminal(RECORDS.imod));
	out.igen.push(terminal(RECORDS.igen));
	out.shdr.push(terminal(RECORDS.shdr, 'EOS'));

	const pdta = Object.keys(RECORDS).map((id) => chunk(id, Buffer.concat(out[id])));
	// Keep smpl even-sized. RIFF pads odd chunks with a byte that alphaTab's
	// reader does not skip, which would hide every chunk after it. Samples are
	// addressed by byte range, so a trailing zero inside the chunk is inert.
	if (smplOffset & 1) smplParts.push(Buffer.alloc(1));
	const body = Buffer.concat([
		Buffer.from('sfbk', 'latin1'),
		sf.info,
		list('sdta', [chunk('smpl', Buffer.concat(smplParts))]),
		list('pdta', pdta)
	]);
	return chunk('RIFF', body);
}
