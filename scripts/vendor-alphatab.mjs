// Adjustments to alphaTab's runtime script as it is copied into static/vendor.
//
// alphaTab 1.8's audio worklet reports every render quantum it plays (128
// frames, ~375 times a second at 48 kHz) to the main thread, which relays it to
// the synth worker, which answers with a playback position. That is over a
// thousand main-thread messages a second whatever the page does. In Firefox
// they were a quarter of the main thread's work during playback, enough to
// saturate a low-end device. Reporting every 512 frames (~11 ms) keeps the
// playback clock exact and the cursor smooth with a quarter of the traffic.
// Applied only to the alphaTab versions in src/library/utils/alphaTabWorkarounds.ts;
// see docs/alphatab-workarounds.md.

/** Frames the worklet plays before reporting them. */
export const REPORT_FRAMES = 512;

// return this.port.postMessage({cmd:X.CmdOutputSamplesPlayed,samples:EXPR}),this.requestBuffers(),this.buffer.count>0||...
const REPORT =
	/this\.port\.postMessage\(\{cmd:([\w$]+)\.CmdOutputSamplesPlayed,samples:([^{}]+?)\}\),this\.([\w$]+)\(\),this\.([\w$]+)\.count>0/g;

/**
 * Whether this alphaTab script's worklet reports every quantum it plays.
 *
 * @param {string} source alphaTab's minified runtime script
 * @returns {boolean}
 */
export function reportsEveryQuantum(source) {
	return [...source.matchAll(REPORT)].length > 0;
}

/**
 * Batch the worklet's played-sample reports. Whatever is left is reported as
 * soon as its buffer runs dry, so the end of a song and every stop are still
 * reported in full. Throws when the code no longer matches, e.g. after an
 * alphaTab upgrade, rather than silently shipping the unbatched worklet.
 *
 * @param {string} source alphaTab's minified runtime script
 * @returns {string}
 */
export function batchWorkletReports(source) {
	const matches = [...source.matchAll(REPORT)];
	if (matches.length !== 1)
		throw new Error(
			`vendor-alphatab: expected one worklet sample report, found ${matches.length}. ` +
				'Check scripts/vendor-alphatab.mjs against the new alphaTab build.'
		);
	return source.replace(
		REPORT,
		/** @type {(match: string, ...groups: string[]) => string} */
		(_, commands, samples, requestBuffers, buffer) =>
			`(this.__unreported=(this.__unreported||0)+${samples},` +
			`(this.__unreported>=${REPORT_FRAMES}||this.${buffer}.count===0)&&` +
			`(this.port.postMessage({cmd:${commands}.CmdOutputSamplesPlayed,samples:this.__unreported}),this.__unreported=0)),` +
			`this.${requestBuffers}(),this.${buffer}.count>0`
	);
}
