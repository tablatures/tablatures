import { error } from '@sveltejs/kit';
import { json } from '@sveltejs/kit';

import type { URL } from "url";
import type { RequestHandler } from "@sveltejs/kit";

type RequestParams = { url: URL }

export async function GET({ url }: RequestParams) /*RequestHandler<>*/ {
    const href = String(url.searchParams.get('href'));

    if (!href) {
        throw error(400, 'the user must provide a valid href')
    }

    return null;

    /*
    const data = await fetch(`https://www.guitarprotabs.net${href}`);
    const content = await data.text();

    const target = extract(content,
        '<a class="btn btn-large pull-right" href="',
        '" rel="nofollow">Download Tab</a>'
    );
    
    const downloadUrl = `https://www.guitarprotabs.net/${target}`;

    return json(downloadUrl);
    */
}