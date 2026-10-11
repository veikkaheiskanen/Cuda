/* Account data crosses the isolated preload bridge; credentials stay in the main process. */
(() => {
  'use strict';
  let library={connected:false,tracks:[],shelf:[],selected:[]};
  const api=(operation,...args)=>window.electronAPI.spotify(operation,...args);
  const element=(tag,text,className)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(className)e.className=className;return e;};
  const button=(text,action,primary=false)=>{const b=element('button',text,primary?'btn-pill-primary':'btn-outline-pill');b.type='button';b.addEventListener('click',()=>run(action));return b;};
  let status;
  async function run(action){try{status.textContent='';await action();}catch(error){status.textContent=error.message;document.dispatchEvent(new CustomEvent('cuda-notice',{detail:error.message}));}}
  function apply(value){library=value;window.spotifyLibrary=value;document.dispatchEvent(new Event('cuda-spotify-library'));renderLibrary();if(status)status.textContent=value.connected?'Connected'+(value.profile?.display_name?' as '+value.profile.display_name:'')+'. '+(value.playbackConnected?'Playback connected. ':'Connect playback below to listen on Spotify. ')+value.tracks.length+' playlist tracks shape your recommendations.':'Connect Spotify to listen and personalize recommendations.';}
  document.addEventListener('DOMContentLoaded',async()=>{
    const old=document.getElementById('card-spotify-import');
    old.replaceChildren();old.classList.add('spotify-settings');
    old.append(element('h3','Spotify'));
    status=element('p','','spotify-status');status.setAttribute('role','status');
    const id=element('input');id.type='text';id.id='spotify-client-id';id.placeholder='Spotify app Client ID';id.maxLength=32;id.autocomplete='off';id.setAttribute('aria-label','Spotify Client ID');
    const actions=element('div',null,'spotify-actions');actions.append(button('Connect Spotify',async()=>{status.textContent='Finish sign-in in your browser…';apply(await api('connect',id.value.trim()));await choosePlaylists();},true),button('Connect playback',async()=>{status.textContent='Finish playback sign-in in your browser…';apply(await api('connectPlayback'));}),button('Choose playlists',choosePlaylists),button('Sync playlists',async()=>apply(await api('sync'))),button('Disconnect',async()=>apply(await api('disconnect'))));
    const guide=element('details');guide.append(element('summary','Spotify setup'));
    const setup=element('ol');for(const text of ['Create an app in the Spotify Developer Dashboard using your Premium account.','Add this Redirect URI exactly: http://127.0.0.1:8898/callback','Copy its Client ID here. Add your account under Users and Access if the app is in development mode.','Connect your library, then choose playlists to shape recommendations. Spotify currently allows access to playlists you own or collaborate on.','Choose Connect playback and complete the separate Spotify streaming sign-in. This uses the native player’s supported sign-in, as in Deck; your library Client ID stays separate.'])setup.append(element('li',text));
    guide.append(setup,button('Open Developer Dashboard',()=>window.open('https://developer.spotify.com/dashboard','_blank')));old.append(id,actions,status,guide);
    const history=element('details');history.append(element('summary','Last.fm history for weekly picks (optional)'));
    const username=element('input');username.placeholder='Last.fm username';username.setAttribute('aria-label','Last.fm username');const key=element('input');key.placeholder='Last.fm API key';key.setAttribute('aria-label','Last.fm API key');
    history.append(element('p','Weekly picks can use your most played artists and avoid albums you already know.','spotify-status'),username,key,button('Use listening history',async()=>apply(await api('lastfm',username.value,key.value))),button('Get a Last.fm API key',()=>window.open('https://www.last.fm/api/account/create','_blank')));old.append(history);
    const section=element('section',null,'spotify-discover');section.id='spotify-discover';const title=element('h3','Your album shelf','section-title');title.id='spotify-section-title';section.append(title);
    const tools=element('div',null,'spotify-actions');const search=element('input');search.placeholder='Find Spotify albums or artists';search.setAttribute('aria-label','Find Spotify albums or artists');search.id='spotify-album-query';
    tools.append(button('Shelf',renderLibrary),search,button('Albums',()=>catalog(search.value,'album')),button('Artists',()=>catalog(search.value,'artist')),button('Weekly picks',weekly));
    const genre=element('input');genre.placeholder='Genre, e.g. jazz';genre.setAttribute('aria-label','Spotify radio genre');genre.id='spotify-radio-genre';
    const radioTools=element('div',null,'spotify-actions');radioTools.append(genre,button('Start genre radio',async()=>{const tracks=await api('radio',genre.value);if(!tracks.length)throw new Error('No radio tracks available.');window.cudaPlayer.startRadio(tracks,genre.value);},true));
    const grid=element('div',null,'spotify-album-grid');grid.id='spotify-albums';const info=element('p',null,'spotify-status');info.id='spotify-shelf-status';section.append(tools,radioTools,info,grid);
    document.getElementById('discover-empty').append(section);
    window.electronAPI?.onSpotifyEvent(value=>{if(value.event==='library')apply(value);});
    try{const value=await api('status');id.value=value.clientId||'';username.value=value.lastfm?.username||'';key.value=value.lastfm?.apiKey||'';apply(value);if(value.connected){(async()=>{if(value.selected.length)apply(await api('sync'));await api('weekly');})().catch(error=>{status.textContent=error.message;});}}catch(error){status.textContent=error.message;}
    // Replace the older public-page scraper import with connected-account selection.
    const legacy=document.getElementById('btn-open-spotify-import');if(legacy)legacy.hidden=true;
  });
  async function choosePlaylists(){
    if(!library.connected)throw new Error('Connect Spotify first.');
    const items=await api('playlists');
    const backdrop=element('div',null,'modal-backdrop visible spotify-playlist-dialog');const dialog=element('div',null,'modal-content');dialog.append(element('h2','Choose your playlists'),element('p','Selected playlists will be added to your recommendation taste.','spotify-status'));
    const list=element('div',null,'spotify-playlist-list');const selected=new Set(library.selected);
    for(const item of items){const label=element('label',null,'spotify-playlist-row');const check=element('input');check.type='checkbox';check.checked=selected.has(item.id);check.disabled=!item.accessible;check.addEventListener('change',()=>check.checked?selected.add(item.id):selected.delete(item.id));const text=element('span',item.name);if(!item.accessible)text.append(element('small','Spotify permits importing owned or collaborative playlists.'));label.append(check,text);list.append(label);}
    if(!items.length)list.append(element('p','No playlists found. Create a playlist in Spotify, then try again.'));
    const feedback=element('p',null,'spotify-status');feedback.setAttribute('role','status');const close=()=>backdrop.remove();const controls=element('div',null,'spotify-actions');controls.append(button('Cancel',close));
    const save=element('button','Use selected playlists','btn-pill-primary');save.addEventListener('click',async()=>{save.disabled=true;feedback.textContent='Fetching selected playlists…';try{apply(await api('sync',[...selected]));close();}catch(error){feedback.textContent=error.message;save.disabled=false;}});controls.append(save);dialog.append(list,feedback,controls);backdrop.append(dialog);document.body.append(backdrop);
    backdrop.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}});
  }
  function renderLibrary(){const section=document.getElementById('spotify-discover');if(!section)return;section.hidden=!library.connected;if(library.connected){document.getElementById('spotify-section-title').textContent='Your album shelf';cards([...library.shelf].sort((a,b)=>(a.artists?.[0]?.name||'').localeCompare(b.artists?.[0]?.name||'')),'Your saved albums stay here. Search to build your shelf.');}}
  function cards(albums,empty='No albums found.'){
    const grid=document.getElementById('spotify-albums');grid.replaceChildren();document.getElementById('spotify-shelf-status').textContent=albums.length?'':empty;
    for(const album of albums){const card=element('article',null,'spotify-album');const image=element('img');const url=album.images?.[0]?.url;if(/^https:\/\//.test(url||''))image.src=url;image.alt='';image.loading='lazy';
      card.append(image,element('h4',album.name),element('p',(album.artists||[]).map(a=>a.name).join(', '),'spotify-status'));if(album.reason)card.append(element('p',album.reason,'spotify-reason'));
      const actions=element('div',null,'spotify-actions');actions.append(button('Play',async()=>{const tracks=await api('albumTracks',album.id);window.cudaPlayer.play(tracks);},true),button('Queue',async()=>window.cudaPlayer.queue(await api('albumTracks',album.id))),button(library.shelf.some(a=>a.id===album.id)?'Remove':'Save',async()=>apply(await api('shelf',album.id,library.shelf.some(a=>a.id===album.id)))));
      if(album.reason)actions.append(button('Dismiss',async()=>{const value=await api('dismiss',album.id);apply(value);cards(value.weekly?.items||[],'No more weekly picks.');}));card.append(actions);grid.append(card);
    }
  }
  async function catalog(query,type){if(!query.trim())return;const results=await api('search',query,type);if(type==='album'){document.getElementById('spotify-section-title').textContent='Albums';cards(results);return;}const grid=document.getElementById('spotify-albums');grid.replaceChildren();for(const artist of results){const card=element('article',null,'spotify-album');card.append(element('h4',artist.name),button('View albums',()=>catalog('artist:'+artist.name,'album')));grid.append(card);}}
  async function weekly(){const value=await api('weekly');document.getElementById('spotify-section-title').textContent='Weekly picks';cards(value.items,'Choose playlists or save albums to get weekly recommendations.');}
})();
