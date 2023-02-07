<script lang="ts">
    import {base} from "$app/paths";
</script>

<div class="p-7 text-sm sm:text-base dark:text-stone-300">
    <img src="{base}/logos/icon.svg" alt="Tablature logo" width="100px" class="m-auto"/>
    <h1 class="text-4xl p-3 text-center">Tablatures</h1>

    <div class="flex flex-col sm:flex-row sm:space-x-1 pt-10">
        <a href="https://https://tablatures.vercel.app/" >
            <img src="https://vercelbadge.vercel.app/api/tablatures/tablatures?style=flat-square" alt="Build" />
        </a>
        
        <a href="https://github.com/tablatures/tablatures/blob/main/package.json" >
            <img src="https://img.shields.io/github/package-json/v/tablatures/tablatures?style=flat-square&color=informational" alt="Version" />
        </a>
        
        <a href="https://github.com/tablatures/tablatures/search?l=svelte" >
            <img src="https://img.shields.io/github/languages/top/tablatures/tablatures?style=flat-square&color=orange" alt="Language" />
        </a>
        
        <a href="https://github.com/tablatures/tablatures/blob/main/LICENSE/" >
            <img src="https://img.shields.io/github/license/tablatures/tablatures?style=flat-square&color=yellow" alt="License" />
        </a>
    </div>
    
    <p class="pt-3">Read and play tabs quickly:</p>
    
    <ul class="pt-3 list-disc px-6">
        <li>Import a music score (.gp3, .gp4, .gp5, .gpx, .gp, .xml, .cap or .tex)</li>
        <li>Browse online tabs databases (GuitarProTab)</li>
        <li>Play along the track (rendered using alphaTab)</li>
    </ul>

    <p class="pt-3">The website is currently under heavy development and can be unstable. <br/>
        Do not hesitate to report issues 
        <a href="https://github.com/tablatures/tablatures/issues" class="underline">here</a>.
    </p>
    
    <h2 class="text-2xl pt-10">Getting started</h2>
    
    <h3 class="text-xl pt-5">Clone and install</h3>

    <ol class="pt-3 list-disc px-6">
        <li>clone the project <code class="bg-stone-900 text-light text-xs px-1 py-0.5">git clone https://github.com/tablatures/tablatures.git</code></li>
        <li>fetch the dependencies <code class="bg-stone-900 text-light text-xs px-1 py-0.5">cd tablatures &amp;&amp; npm i</code></li>
        <li>launch with hot-reload <code class="bg-stone-900 text-light text-xs px-1 py-0.5">npm run start</code></li>
    </ol>

    <h3 class="text-xl pt-5">Build and deploy</h3>
    
    <ol class="pt-3 list-disc px-6">
        <li>build the website <code class="bg-stone-900 text-light text-xs px-1 py-0.5">npm run build</code></li>
        <li>run on server <code class="bg-stone-900 text-light text-xs px-1 py-0.5">npm run preview</code></li>
    </ol>

    <h2 class="text-2xl pt-10">Made with</h2>
    
    <ul class="pt-3 list-disc px-6">
        <li>Vite: <a href="https://github.com/vitejs/vite" class="underline">https://github.com/vitejs/vite</a></li>
        <li>SvelteKit: <a href="https://github.com/sveltejs/kit" class="underline">https://github.com/sveltejs/kit</a></li>
        <li>Tailwind: <a href="https://github.com/tailwindlabs/tailwindcss" class="underline">https://github.com/tailwindlabs/tailwindcss</a></li>
        <li>AlphaTab: <a href="https://github.com/CoderLine/alphaTab" class="underline">https://github.com/CoderLine/alphaTab</a></li>
    </ul>
    
</div>