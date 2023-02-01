<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

    let api: any = undefined;
    let target: any = undefined;
    let loaded: boolean = false;

    onMount(async () => {
        if (!window.alphaTab) return;
        api = new window.alphaTab.AlphaTabApi(target, {
            file: "https://www.alphatab.net/files/canon.gp",
            core: {
                tex: true,
                engine: "html5",
                logLevel: 1,
                useWorkers: true,
            },
            display: {
                staveProfile: "Default",
            },
            notation: {
                elements: {
                    scoreTitle: true,
                    scoreWordsAndMusic: true,
                    effectTempo: true,
                    guitarTuning: true,
                },
            },
            player: {
                enablePlayer: true,
                enableUserInteraction: true,
                enableCursor: true,
                soundFont: `https://cdn.jsdelivr.net/npm/@coderline/alphatab@alpha/dist/soundfont/sonivox.sf2`,
            },
        })

        api.soundFontLoaded.on(async () => {
            loaded = true;

            // api.load();
        });

    })

    onDestroy(async () => {
        if (!api) return;

        api.destroy()
        api = undefined
    })
</script>

<div class="sticky top-0">
    <button on:click={api?.play()}>play</button>
    <button on:click={api?.pause()}>pause</button>
</div>

<div bind:this={target} />