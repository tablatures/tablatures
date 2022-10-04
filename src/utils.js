
/**
 * Tracks sources enum
 */
const SOURCES = {
  GUITAR_PRO_TABS: 0
}

/**
 * Check if a value is already associated 
 * @param {object} db database to search
 * @param {string[]} keys path to the value
 * @return {boolean} true if value in db, false otherwise
 */
function dbFound(db, keys) {
  return dbSearch(db, keys) !== undefined
}

/**
 * Return the value associated to the keys path
 * @param {object} db database to search
 * @param {string[]} keys path to the value
 * @return {object | undefined} the found object
 */
function dbSearch(db, keys) {
  if (!keys.length) throw new Error("Keys passed to the db search are not valid")

  const current = db[keys[0]] // current database layer associated to the key
  
  if (keys.length > 1) {
    return current === undefined ? undefined : dbSearch(current, keys.splice(1))
  } else {
    return current // The keys are reached and a value is associated
  }
}

/**
 * Insert the value at the given db path
 * @param {object} db database to search
 * @param {string[]} keys path to the value
 * @param {object} value object to insert
 */
function dbInsert(db, keys, value) {

  if (keys.length > 1) {
    
    // Initialise value if not existing
    if (db[keys[0]] === undefined) db[keys[0]] = {}

    // Recursive call on the current layer
    dbInsert(db[keys[0]], keys.splice(1), value)

  } else {

    // Insert the value at the current layer
    db[keys[0]] = value

  }
}

/**
 * Proxy the request through api.allorigins.win to avoid CORS issues
 * @param {string} source url to request
 * @returns reponse as json (data in contents)
 */
async function proxy(source) {
  try {
    const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(source)}`)
    return response.json()
  } catch (error) {
    throw new Error(`Error during the proxy request: ${error}`)
  }
}

/**
 * Extract the value between two tokens (exclusive)
 * @param {string} content the input string containing both tokens
 * @param {string} start_token the start token
 * @param {string} end_token the end token
 * @returns the value between the tokens
 */
function extract(content, start_token, end_token) {
  const start_index = content.indexOf(start_token) + start_token.length
  const end_index = content.indexOf(end_token)
  return content.substring(0, end_index).substring(start_index);
}

/**
 * Fetch the list of track for the given source
 * @param {number} source database website
 * @param {number} pages number of pages to fetch
 * @param {number} index index of the page to fetch
 * @param {string} query db index for storage
 * @param {object} database `{ [query]: { [index]: [tracks] } }`
 */
async function fetchList(source, pages, index, query, database) {
  switch (source) {
    case SOURCES.GUITAR_PRO_TABS: return await fetchListGuitarProTabs(pages, index, query, database)
    default: throw new Error(`Source '${source}' is not specified for the list scrapping.`)
  }
}

/**
 * Fetch the list of track for guitarprotabs
 * @param {number} pages number of pages to fetch
 * @param {number} index index of the current page
 * @param {string} query db index for storage
 * @param {object} database `{ [query]: { [index]: [tracks] } }`
 */
async function fetchListGuitarProTabs(pages, index, query, database) {

  if (pages < 1) return // Stop recursive call

  let found_tabs = false // have we reached the end ?
  
  // If a value is already stored in the local database
  if (dbFound(database, [query, index])) { 

    // We can validate the tab and go to the recursive call
    found_tabs = true

  } else {

    // Otherwise, we need to fetch it and parse it from remote
    const parser = new DOMParser();
    const source = `https://www.guitarprotabs.net/artist/${query}/${index}`
    const content = await proxy(source)

    // Extract the page table
    const source_table = await extract(content.contents, '<table class="table table-striped">', '</table>')
    
    // Virtualize an html table element for queries
    const fragment = parser.parseFromString(`<table>${source_table}</table>`, "text/html");
  
    const table = fragment.getElementsByTagName("table")[0]

    Array.from(table.rows).forEach((row, id) => {
      
      const firstCell = row.cells[0].firstChild
      const trackLink = row.cells[1].firstChild.firstChild
      const groupLink = row.cells[1].children[2]

      const inner = row.cells[2].innerHTML.split("<br>")[1]

      const parsed = parser.parseFromString(String(inner), "text/html");
      const links = parsed.getElementsByTagName("a")
      const album = links.length ? links[0].innerHTML : "-"

      const [views, tracks] = row.cells[3].innerHTML.split("<br>")

      found_tabs = true

      const track = {
        source: SOURCES.GUITAR_PRO_TABS,
        type: firstCell.innerHTML,
        track: {
          href: trackLink?.attributes.href.value, // get relative
          title: trackLink?.title,
        },
        group: {
          href: groupLink?.attributes.href.value, // get relative
          title: groupLink?.title,
        },
        album: album,
        views: views?.split("# Views ")[1],
        tracks: tracks?.split("# Tracks ")[1]
      }
    
      dbInsert(database, [query, index, id], track)
    })
  }

  // recursive call
  if (found_tabs) {
    await fetchListGuitarProTabs(pages - 1, index + 1, query, database)
  }
}

/**
 * Fetch the track .pg5 file for the given source
 * @param {number} source database website
 * @param {object} target the track to fetch { title, href }
 * @return {object} fetched track row datas
 */
async function fetchTrack(source, target) {
  switch (source) {
    case SOURCES.GUITAR_PRO_TABS: return await fetchTrackGuitarProTabs(target)
    default: throw new Error("No source specified for the track scrapping.")
  }
}

/**
 * Fetch the track .gp5 file for guitarprotabs
 * @param {object} target the track to fetch { title, href }
 * @return {object} fetched track row datas
 */
async function fetchTrackGuitarProTabs(target) {

  const content = await proxy(`https://www.guitarprotabs.net${target.href}`)

  // Extract the page download button link
  const href = await extract(content.contents, '<a class="btn btn-large pull-right" href="', '" rel="nofollow">Download Tab</a>')
  const download = await proxy(`https://www.guitarprotabs.net/${href}`)
  const track = { name: target.title + ".gp5", data: download.contents }

  return track
}

async function fetchSound() {
  try {
    const response = await fetch(`https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.2.1/dist/soundfont/sonivox.sf2`)
    const buffer = await response.arrayBuffer()
    const array = new Uint8Array(buffer)
    return array
  } catch (error) {
    throw new Error(`Error during the sound request: ${error}`)
  }
}

export { SOURCES, fetchList, fetchTrack, fetchSound }