export interface Track {
    href: string | null;
    title: string | null;
  }
  
  export interface RootObject {
    source: number;
    type: string;
    track: Track;
    group: Track;
    album: string;
    views: string;
    tracks: string;
  }
  
