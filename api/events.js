import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

const DEFAULT_IMAGE = 'https://i.ibb.co/dHPWxr8/depete.jpg';

/**
 * Función para hacer scraping de ppvs.su
 */
async function fetchPpvsSuEvents() {
    try {
        console.log('Fetching ppvs.su eventos JSON...');
        const response = await fetch('https://ppvs.su/api/streams', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 10000
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        
        const data = await response.json();
        const events = [];
        
        if (data.success && data.streams) {
            data.streams.forEach(category => {
                if (category.streams) {
                    category.streams.forEach(stream => {
                        const eventDate = new Date(stream.starts_at * 1000);
                        const endDate = new Date(stream.ends_at * 1000);
                        const now = new Date();
                        
                        // Verificar si el evento está en vivo o próximo
                        const isLive = now >= eventDate && now <= endDate;
                        const isUpcoming = eventDate > now;
                        
                        if (isLive || isUpcoming) {
                            const time = isLive ? 'En vivo' : eventDate.toLocaleTimeString('es-AR', { 
                                hour: '2-digit', 
                                minute: '2-digit', 
                                timeZone: 'America/Argentina/Buenos_Aires', 
                                hour12: false 
                            });
                            
                            events.push({
                                time,
                                title: stream.name,
                                link: stream.iframe,
                                button: stream.tag || 'CANAL',
                                category: stream.category_name || 'Otros',
                                language: 'Inglés',
                                date: eventDate.toISOString().split('T')[0],
                                source: 'ppvs.su',
                                image: stream.poster || DEFAULT_IMAGE,
                                status: isLive ? 'En vivo' : 'Próximo',
                                viewers: stream.viewers || '0'
                            });
                        }
                    });
                }
            });
        }
        
        console.log(`ppvs.su: ${events.length} eventos obtenidos.`);
        return events;
    } catch (error) {
        console.error('Error al obtener eventos de ppvs.su:', error);
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
                imageUrl = `https://wearechecking.online/${imageSrc.replace(/^\.\.\//, '')}`;
            }

            $wrapper.find('.stream-feed[onclick]').each((j, feedEl) => {
                const $feed = $(feedEl);
                const onclick = $feed.attr('onclick');
                const match = onclick ? onclick.match(/location\.href='([^']+)'/) : null;
                const link = match ? `https://wearechecking.online${match[1]}` : '';
                const $p = $feed.find('p');
                
                if ($p.length === 0 || /No events/i.test($p.text())) return;
                
                let time = '-';
                let title = $p.text().trim();
                const $span = $p.find('.unix-timestamp');
                
                if ($span.length) {
                    let spanText = $span.text().replace(/ ￨ |\\|/g, '').trim();
                    time = spanText;
                    title = $p.text().replace($span.text(), '').replace(/^\s*￨\s*/, '').replace(/^\s*\|\s*/, '').trim();
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
                    image: imageUrl,
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
        
        const [ppvsEvents, wacMotorsportsEvents] = await Promise.allSettled([
            fetchPpvsSuEvents(),
            fetchWeAreCheckingMotorsportsEvents()
        ]);

        const ppvsEventsArray = ppvsEvents.status === 'fulfilled' ? ppvsEvents.value : [];
        const wearecheckingMotorsportsEvents = wacMotorsportsEvents.status === 'fulfilled' ? wacMotorsportsEvents.value : [];
        
        if (ppvsEvents.status === 'rejected') console.error('ppvs.su falló:', ppvsEvents.reason);
        if (wacMotorsportsEvents.status === 'rejected') console.error('WeAreChecking Motorsports falló:', wacMotorsportsEvents.reason);

        const allEvents = [...ppvsEventsArray, ...wearecheckingMotorsportsEvents];
        console.log(`Total eventos combinados: ${allEvents.length}`);
        
        if (allEvents.length === 0) {
            console.warn('No se obtuvieron eventos de ninguna fuente');
            return res.status(200).json([]);
        }
        
        const eventMap = new Map();
        allEvents.forEach(event => {
            if (!event || !event.title) return;

            event.image = event.image || DEFAULT_IMAGE;

            const key = `${event.title || 'Sin título'}__${event.time || '-'}__${event.source}`;
            if (!eventMap.has(key)) {
                let buttonArr = [];
                let optionsArr = [];
                
                if (event.source === 'ppvs.su' && event.link) {
                    buttonArr = [event.button || 'CANAL'];
                    optionsArr = [event.link];
                } else if (event.source === 'wearechecking-motorsports' && Array.isArray(event.options) && event.options.length > 0) {
                    buttonArr = event.options.map(opt => (opt.name || 'CANAL').toUpperCase());
                    optionsArr = event.options.map(opt => opt.link);
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
                    image: event.image || DEFAULT_IMAGE,
                    status: event.status || 'Desconocido',
                    viewers: event.viewers || '0'
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
        
        // Asegurar que todos los eventos tengan una imagen
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