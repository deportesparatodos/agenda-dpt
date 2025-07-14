import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

const DEFAULT_IMAGE = 'https://i.ibb.co/dHPWxr8/depete.jpg';

/**
 * Función para hacer scraping de streamtpglobal.com
 */
async function fetchStreamTpGlobalEvents() {
    try {
        console.log('Fetching StreamTpGlobal eventos JSON...');
        const response = await fetch('https://streamtpglobal.com/eventos.json', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        
        const events = await response.json();
        console.log(`StreamTpGlobal: ${events.length} eventos obtenidos.`);
        
        return events.map(event => ({
            ...event,
            source: 'streamtpglobal',
            category: 'Otros'
        }));
    } catch (error) {
        console.error('Error al obtener eventos de StreamTpGlobal:', error);
        return [];
    }
}

/**
 * Scrapea los links de cada evento de wearechecking.online
 */
async function fetchWACLinksForEvent(eventUrl) {
    try {
        const response = await fetch(eventUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            timeout: 15000
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        const html = await response.text();
        const $ = cheerio.load(html);
        const options = [];
        $('.feed-buttons-wrapper .feed-button').each((i, btn) => {
            const onclick = $(btn).attr('onclick') || '';
            const match = onclick.match(/src = '([^']+)'/);
            const link = match ? match[1] : '';
            const name = $(btn).find('p').text().trim() || 'Canal';
            if (link) {
                options.push({ name, link });
            }
        });
        return options;
    } catch (error) {
        console.error('Error al obtener links de evento WAC:', eventUrl, error);
        return [];
    }
}

/**
 * Scrapea eventos en vivo de wearechecking.online/streams-pages/motorsports
 */
async function fetchWeAreCheckingMotorsportsEvents() {
    try {
        const url = 'https://wearechecking.online/streams-pages/motorsports';
        console.log('Fetching WeAreChecking Motorsports eventos desde', url);
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
            timeout: 15000
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        const html = await response.text();
        const $ = cheerio.load(html);
        const events = [];
        const eventPromises = [];
        $('#streams-dynamic-container .stream-wrapper').each((i, el) => {
            const $wrapper = $(el);
            // Extraer la imagen de la card actual
            const imageSrc = $wrapper.find('.stream-thumb').attr('src');
            let imageUrl = DEFAULT_IMAGE; // Usar imagen por defecto como fallback
            if (imageSrc) {
                // Construir la URL absoluta
                imageUrl = `https://wearechecking.online/${imageSrc.replace(/..[\\/]/, '')}`;
            }

            $wrapper.find('.stream-feed[onclick]').each((j, feedEl) => {
                const $feed = $(feedEl);
                const onclick = $feed.attr('onclick');
                const match = onclick ? onclick.match(/location.href='([^']+)'/) : null;
                const link = match ? `https://wearechecking.online${match[1]}` : '';
                const $p = $feed.find('p');
                if ($p.length === 0 || /No events/i.test($p.text())) return;
                let time = '-';
                let title = $p.text().trim();
                const $span = $p.find('.unix-timestamp');
                if ($span.length) {
                     let spanText = $span.text().replace(/ ￨ |\\|/g, '').trim();
                     time = spanText;
                     title = $p.text().replace($span.text(), '').replace(/^\s* ￨ \s*/, '').replace(/^\s*\|\s*/, '').trim();
                }
                const eventObj = {
                    time,
                    title,
                    link,
                    button: 'WAC',
                    category: 'Motor Sports',
                    language: 'Inglés',
                    date: new Date().toISOString().split('T')[0],
                    source: 'wearechecking-motorsports',
                    image: imageUrl, // Usar la imagen de la card
                    options: []
                };
                const p = fetchWACLinksForEvent(link).then(options => {
                    eventObj.options = options;
                    return eventObj;
                });
                eventPromises.push(p);
            });
        });
        const results = await Promise.all(eventPromises);
        return results.filter(ev => ev.options && ev.options.length > 0);
    } catch (error) {
        console.error('Error al obtener eventos de WeAreChecking Motorsports:', error);
        return [];
    }
}

/**
 * Obtiene el mapa de categorías de deportes desde streamed.su
 */
async function fetchStreamedSuSports() {
    try {
        console.log('Fetching Streamed.su sports categories...');
        const response = await fetch('https://streamed.su/api/sports');
        if (!response.ok) {
            throw new Error(`Streamed.su API error for sports: ${response.status}`);
        }
        const sports = await response.json();
        const sportsMap = new Map();
        sports.forEach(sport => sportsMap.set(sport.id, sport.name));
        console.log('Streamed.su sports categories loaded.');
        return sportsMap;
    } catch (error) {
        console.error('Error fetching Streamed.su sports categories:', error.message);
        return new Map(); // Devuelve un mapa vacío en caso de error
    }
}


/**
 * Obtiene eventos en vivo desde la API de streamed.su
 */
async function fetchStreamedSuEvents(sportsMap) {
    try {
        console.log('Fetching Streamed.su live and today matches...');
        const [liveResponse, todayResponse] = await Promise.allSettled([
            fetch('https://streamed.su/api/matches/live', { headers: { 'User-Agent': 'Mozilla/5.0' } }),
            fetch('https://streamed.su/api/matches/all-today', { headers: { 'User-Agent': 'Mozilla/5.0' } })
        ]);

        const matchesMap = new Map();

        // Procesar eventos en vivo
        if (liveResponse.status === 'fulfilled' && liveResponse.value.ok) {
            const liveMatches = await liveResponse.value.json();
            liveMatches.forEach(match => {
                matchesMap.set(match.id, { ...match, computedStatus: 'En vivo' });
            });
        } else {
            console.error('Failed to fetch live matches from Streamed.su');
        }

        // Procesar eventos de hoy
        if (todayResponse.status === 'fulfilled' && todayResponse.value.ok) {
            const todayMatches = await todayResponse.value.json();
            todayMatches.forEach(match => {
                if (!matchesMap.has(match.id)) { // No sobreescribir si ya está como "En vivo"
                    const now = new Date();
                    const eventDate = new Date(match.date);
                    const status = eventDate > now ? 'Próximo' : 'Finalizado';
                    matchesMap.set(match.id, { ...match, computedStatus: status });
                }
            });
        } else {
            console.error('Failed to fetch today\'s matches from Streamed.su');
        }

        const uniqueMatches = Array.from(matchesMap.values());
        console.log(`Streamed.su: ${uniqueMatches.length} total matches found for today/live.`);

        // Procesar todos los partidos para crear los eventos
        const eventPromises = uniqueMatches.map(async (match) => {
            try {
                if (!match.sources || match.sources.length === 0) return null;

                const streamSourcesPromises = match.sources.map(source =>
                    fetch(`https://streamed.su/api/stream/${source.source}/${source.id}`, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
                        timeout: 10000
                    })
                    .then(res => res.ok ? res.json() : [])
                    .catch(() => [])
                );

                const streamSourcesArrays = await Promise.all(streamSourcesPromises);
                const allStreams = streamSourcesArrays.flat().filter(s => s && s.embedUrl);

                if (allStreams.length === 0) return null;

                const eventDate = new Date(match.date);
                
                const time = match.computedStatus === 'En vivo' ? 'En vivo' : eventDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires', hour12: false });

                // Lógica de imágenes con la prioridad correcta
                let imageUrl = '';
                if (match.teams?.home?.badge && match.teams?.away?.badge) {
                    imageUrl = `https://streamed.su/api/images/poster/${match.teams.home.badge}/${match.teams.away.badge}.webp`;
                } else if (match.poster) {
                    imageUrl = `https://streamed.su/api/images/proxy/${match.poster}.webp`;
                } else if (match.teams?.home?.badge) {
                    imageUrl = `https://streamed.su/api/images/badge/${match.teams.home.badge}.webp`;
                } else if (match.teams?.away?.badge) {
                    imageUrl = `https://streamed.su/api/images/badge/${match.teams.away.badge}.webp`;
                }

                const buttons = allStreams.map(stream => {
                    let name = (stream.language || `Stream ${stream.streamNo}`).toUpperCase().trim();
                    if (stream.hd) {
                        name += ' HD';
                    }
                    return name;
                });

                return {
                    time: time,
                    title: match.title,
                    options: allStreams.map(stream => stream.embedUrl),
                    buttons: buttons,
                    category: sportsMap.get(match.category) || 'Otros',
                    language: [...new Set(allStreams.map(s => s.language).filter(Boolean))].join(', ') || 'N/A',
                    date: eventDate.toISOString().split('T')[0],
                    source: 'streamedsu',
                    image: imageUrl,
                    status: match.computedStatus,
                };
            } catch (error) {
                console.error(`Error procesando partido de Streamed.su "${match.title}":`, error);
                return null;
            }
        });

        const events = (await Promise.all(eventPromises)).filter(Boolean);
        console.log(`Streamed.su: ${events.length} eventos procesados exitosamente.`);
        return events;

    } catch (error) {
        console.error('Error al obtener eventos de Streamed.su:', error.message);
        return [];
    }
}


// --- FUNCIÓN PRINCIPAL EXPORTADA ---
export default async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        console.log('Iniciando obtención de eventos...');
        const sportsMap = await fetchStreamedSuSports();
        
        const [streamTpEvents, wacMotorsportsEvents, streamedSuEvents] = await Promise.allSettled([
            fetchStreamTpGlobalEvents(),
            fetchWeAreCheckingMotorsportsEvents(),
            fetchStreamedSuEvents(sportsMap)
        ]);

        const streamEvents = streamTpEvents.status === 'fulfilled' ? streamTpEvents.value : [];
        const wearecheckingMotorsportsEvents = wacMotorsportsEvents.status === 'fulfilled' ? wacMotorsportsEvents.value : [];
        const newStreamedSuEvents = streamedSuEvents.status === 'fulfilled' ? streamedSuEvents.value : [];
        
        if (streamTpEvents.status === 'rejected') console.error('StreamTpGlobal falló:', streamTpEvents.reason);
        if (wacMotorsportsEvents.status === 'rejected') console.error('WeAreChecking Motorsports falló:', wacMotorsportsEvents.reason);
        if (streamedSuEvents.status === 'rejected') console.error('Streamed.su falló:', streamedSuEvents.reason);

        const allEvents = [...streamEvents, ...wearecheckingMotorsportsEvents, ...newStreamedSuEvents];
        console.log(`Total eventos combinados: ${allEvents.length}`);
        
        if (allEvents.length === 0) {
            console.warn('No se obtuvieron eventos de ninguna fuente');
            return res.status(200).json([]);
        }
        
        const eventMap = new Map();
        allEvents.forEach(event => {
            if (!event || !event.title) return;

            if (event.source !== 'streamedsu') {
                event.image = DEFAULT_IMAGE;
            }

            const key = `${event.title || 'Sin título'}__${event.time || '-'}__${event.source}`;
            if (!eventMap.has(key)) {
                let buttonArr = [];
                let optionsArr = [];
                if (event.source === 'streamtpglobal' && event.link) {
                    const match = event.link.match(/[?&]stream=([^&#]+)/i);
                    buttonArr = [match ? match[1].toUpperCase() : 'CANAL'];
                    optionsArr = [event.link];
                } else if (event.source === 'wearechecking-motorsports' && Array.isArray(event.options) && event.options.length > 0) {
                    buttonArr = event.options.map(opt => (opt.name || 'CANAL').toUpperCase());
                    optionsArr = event.options.map(opt => opt.link);
                } else if (event.source === 'streamedsu' && Array.isArray(event.options)) {
                    buttonArr = event.buttons;
                    optionsArr = event.options;
                } else if (event.button) {
                    buttonArr = [event.button];
                    optionsArr = [event.link];
                } else {
                    optionsArr = [event.link];
                }
                eventMap.set(key, {
                    time: event.time || '-',
                    title: event.title || 'Sin título',
                    options: optionsArr,
                    buttons: buttonArr,
                    category: event.category || 'Otros',
                    language: event.language || 'Desconocido',
                    date: event.date || new Date().toISOString().split('T')[0],
                    source: event.source || 'unknown',
                    image: event.image || '',
                    status: event.status || 'Desconocido'
                });
            } else {
                const existing = eventMap.get(key);
                if (event.source === 'wearechecking-motorsports' && Array.isArray(event.options)) {
                    event.options.forEach(opt => {
                        if (!existing.options.includes(opt.link)) {
                            existing.options.push(opt.link);
                            existing.buttons.push(opt.name.toUpperCase());
                        }
                    });
                } else if (event.link && !existing.options.includes(event.link)) {
                    existing.options.push(event.link);
                    if (event.button) existing.buttons.push(event.button);
                }
            }
        });

        let adaptedEvents = Array.from(eventMap.values());
        
        adaptedEvents = adaptedEvents.map(event => {
            if (!event.image) {
                event.image = DEFAULT_IMAGE;
            }
            return event;
        });
        
        return res.status(200).json(adaptedEvents);
    } catch (error) {
        console.error('Error en la función principal:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
};
