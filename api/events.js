import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

/**
 * Detecta dinámicamente el dominio base de AlanGuloTV siguiendo redirecciones.
 * Esto evita tener que cambiar manualmente los dominios cuando expiran.
 */
async function getDynamicAlanGuloConfig() {
    const mainUrl = 'https://alangulotv.live';
    try {
        const response = await fetch(mainUrl, {
            redirect: 'follow', // Sigue las redirecciones automáticamente
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const finalUrl = new URL(response.url);
        const baseOrigin = finalUrl.origin; // e.g., https://alangulotv.space
        const agendaUrl = `${baseOrigin}/agenda-2/`;
        const linkDomain = `p.${finalUrl.hostname}`; // e.g., p.alangulotv.space

        console.log(`Dominio de AlanGuloTV detectado: ${baseOrigin}`);

        return { baseOrigin, agendaUrl, linkDomain };
    } catch (error) {
        console.error('No se pudo obtener el dominio dinámico de AlanGuloTV. Usando valores por defecto.', error);
        // Fallback a los últimos dominios conocidos para no romper la API
        const baseOrigin = 'https://alangulotv.space';
        const agendaUrl = `${baseOrigin}/agenda-2/`;
        const linkDomain = 'p.alangulotv.space';
        return { baseOrigin, agendaUrl, linkDomain };
    }
}


/**
 * Función para hacer scraping de streamtpglobal.com (sin cambios)
 */
async function fetchStreamTpGlobalEvents() {
    try {
        console.log('Fetching StreamTpGlobal eventos JSON...');
        const response = await fetch('https://streamtpglobal.com/eventos.json', {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            timeout: 10000
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        const events = await response.json();
        console.log(`StreamTpGlobal: ${events.length} eventos obtenidos.`);
        return events.map(event => ({ ...event, source: 'streamtpglobal' }));
    } catch (error) {
        console.error('Error al obtener eventos de StreamTpGlobal:', error);
        return [];
    }
}

/**
 * NUEVA LÓGICA: Extrae el iframe final de cada página de canal.
 * @param {string} channelPageUrl - La URL de la página del canal (ej: /canal/espn/)
 * @param {object} config - El objeto de configuración con baseOrigin.
 * @returns {Promise<string|null>} La URL del src del iframe o null si no se encuentra.
 */
async function fetchFinalIframeSrc(channelPageUrl, config) {
    try {
        // Asegurarse de que la URL sea absoluta
        const absoluteUrl = new URL(channelPageUrl, config.baseOrigin).href;
        const response = await fetch(absoluteUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 10000
        });
        if (!response.ok) return null;

        const html = await response.text();
        const $ = cheerio.load(html);
        
        // Buscar el iframe principal y devolver su src
        const iframeSrc = $('#mainIframe').attr('src');
        
        // Si el src es relativo (ej: /?channel=...), hacerlo absoluto
        if (iframeSrc && iframeSrc.startsWith('/')) {
            return `https://${config.linkDomain}${iframeSrc}`;
        }
        
        return iframeSrc || null;

    } catch (error) {
        console.error(`Error al scrapear la página del canal ${channelPageUrl}:`, error);
        return null;
    }
}


/**
 * NUEVA LÓGICA: Función para hacer scraping de alangulotv.
 * 1. Scrapea la agenda.
 * 2. Para cada evento, visita las páginas de los canales para obtener el iframe final.
 */
async function fetchAlanGuloTVEvents(config) {
    const { agendaUrl, baseOrigin, linkDomain } = config;
    try {
        console.log(`Fetching AlanGuloTV eventos desde ${agendaUrl}...`);
        const response = await fetch(agendaUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 15000
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

        const html = await response.text();
        const $ = cheerio.load(html);
        const events = [];

        // Usamos un array de promesas para procesar todos los eventos en paralelo
        const eventPromises = [];

        $('.match-container').each((index, element) => {
            const promise = (async () => {
                try {
                    const $container = $(element);
                    
                    // 1. Extraer datos básicos del evento
                    let imageUrl = $container.find('img.event-logo, img.team-logo').first().attr('src') || '';
                     if (imageUrl && imageUrl.startsWith('/')) {
                        // Las imágenes de eventos a menudo están en el dominio 'p.'
                        imageUrl = `https://${linkDomain}${imageUrl}`;
                    }
                    
                    const time = $container.find('.time').text().trim() || '00:00';
                    const teamNames = [];
                    $container.find('.team-name').each((i, el) => teamNames.push($(el).text().trim()));
                    const title = teamNames.length >= 2 ? `${teamNames[0]} vs ${teamNames[1]}` : teamNames[0] || 'Evento sin título';

                    // Forzar imagen MLB
                    if (title.toUpperCase().includes('MLB')) {
                        imageUrl = `https://${linkDomain}/mlb`;
                    }

                    // 2. Encontrar los botones y sus enlaces a las páginas de canal
                    const $linksContainer = $container.next('.links-container');
                    const channelLinks = [];
                    $linksContainer.find('.link-button, a').each((i, linkEl) => {
                        const $link = $(linkEl);
                        const pageUrl = $link.attr('href');
                        const buttonName = $link.text().trim() || 'CANAL';
                        if (pageUrl) {
                            channelLinks.push({ buttonName, pageUrl });
                        }
                    });

                    if (channelLinks.length === 0) return null;

                    // 3. Scrapear cada página de canal para obtener el iframe final
                    const iframeSrcPromises = channelLinks.map(link => fetchFinalIframeSrc(link.pageUrl, config));
                    const finalIframeSrcs = await Promise.all(iframeSrcPromises);

                    // 4. Filtrar los resultados y crear el objeto de evento
                    const options = [];
                    const buttons = [];
                    finalIframeSrcs.forEach((src, i) => {
                        if (src) { // Solo añadir si el scraping del iframe fue exitoso
                            options.push(src);
                            buttons.push(channelLinks[i].buttonName);
                        }
                    });
                    
                    // Solo agregar el evento si tiene al menos una opción válida
                    if (options.length > 0) {
                        return {
                            time,
                            title,
                            options, // Array de URLs de iframes finales
                            buttons, // Array de nombres de botones
                            category: 'Deportes',
                            language: 'Español',
                            date: new Date().toISOString().split('T')[0],
                            source: 'alangulotv',
                            image: imageUrl
                        };
                    }

                } catch (error) {
                    console.error('Error procesando un evento de AlanGuloTV:', error);
                    return null;
                }
            })();
            eventPromises.push(promise);
        });

        const resolvedEvents = await Promise.all(eventPromises);
        // Filtrar cualquier evento que haya resultado en null (por errores o falta de links)
        const validEvents = resolvedEvents.filter(event => event !== null);

        console.log(`AlanGuloTV: ${validEvents.length} eventos obtenidos con la nueva lógica.`);
        return validEvents;

    } catch (error) {
        console.error('Error grave al obtener eventos de AlanGuloTV:', error);
        return [];
    }
}


export default async (req, res) => {
    // Configurar CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        console.log('Iniciando obtención de eventos...');
        const alanGuloConfig = await getDynamicAlanGuloConfig();

        const [streamTpEventsResult, alanGuloEventsResult] = await Promise.allSettled([
            fetchStreamTpGlobalEvents(),
            fetchAlanGuloTVEvents(alanGuloConfig)
        ]);

        const streamEvents = streamTpEventsResult.status === 'fulfilled' ? streamTpEventsResult.value : [];
        const alanEvents = alanGuloEventsResult.status === 'fulfilled' ? alanGuloEventsResult.value : [];
        
        if (streamTpEventsResult.status === 'rejected') console.error('StreamTpGlobal falló:', streamTpEventsResult.reason);
        if (alanGuloEventsResult.status === 'rejected') console.error('AlanGuloTV falló:', alanGuloEventsResult.reason);

        // Aplanar los eventos de AlanGuloTV, ya que ahora vienen con `options` y `buttons`
        const flattenedAlanEvents = [];
        alanEvents.forEach(event => {
            // El evento ya tiene la estructura correcta con `options` y `buttons`
            flattenedAlanEvents.push(event);
        });
        
        // Aplanar los eventos de StreamTpGlobal para que coincidan con la estructura
        const flattenedStreamEvents = [];
        streamEvents.forEach(event => {
            const match = event.link ? event.link.match(/[?&]stream=([^&#]+)/i) : null;
            const buttonName = match ? match[1].toUpperCase() : 'CANAL';
            
            // Ajustar hora de StreamTpGlobal
            let adjustedTime = event.time || '00:00';
            const timeParts = adjustedTime.split(':');
            if (timeParts.length >= 2) {
                let hour = parseInt(timeParts[0], 10);
                const minute = parseInt(timeParts[1], 10);
                if (!isNaN(hour) && !isNaN(minute)) {
                    hour += 2;
                    if (hour >= 24) hour -= 24;
                    adjustedTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                }
            }

            flattenedStreamEvents.push({
                time: adjustedTime,
                title: event.title,
                options: [event.link],
                buttons: [buttonName],
                category: event.category,
                language: event.language,
                date: event.date,
                source: 'streamtpglobal',
                image: event.image || ''
            });
        });

        const allEvents = [...flattenedStreamEvents, ...flattenedAlanEvents];
        console.log(`Total eventos combinados: ${allEvents.length}`);
        
        if (allEvents.length === 0) {
            console.warn('No se obtuvieron eventos de ninguna fuente');
            return res.status(200).json([]);
        }
        
        // --- LÓGICA DE AGRUPACIÓN Y LIMPIEZA FINAL ---
        // (Esta parte sigue siendo útil para fusionar eventos duplicados de ambas fuentes)
        
        function quitarPrefijoTitulo(titulo) {
            if (!titulo) return '';
            const partes = titulo.split(': ');
            return partes.length > 1 ? partes.slice(1).join(': ').trim() : titulo.trim();
        }
        function equiposCoinciden(ev1, ev2) {
            const norm = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\b(fc|vs|club|deportivo)\b/gi, '').replace(/[^a-z0-9]/g, '').trim();
            const eq1 = new Set(quitarPrefijoTitulo(ev1.title).split(' ').map(norm).filter(Boolean));
            const eq2 = new Set(quitarPrefijoTitulo(ev2.title).split(' ').map(norm).filter(Boolean));
            const inter = new Set([...eq1].filter(x => eq2.has(x)));
            return inter.size >= 2; // Considerar una coincidencia si al menos 2 palabras clave (equipos) son iguales
        }
        function minutosDiferencia(t1, t2) {
            const [h1, m1] = t1.split(':').map(Number);
            const [h2, m2] = t2.split(':').map(Number);
            return Math.abs((h1 * 60 + m1) - (h2 * 60 + m2));
        }

        const agrupados = [];
        for (const ev of allEvents) {
            let encontrado = false;
            for (const grupo of agrupados) {
                if (equiposCoinciden(grupo, ev) && minutosDiferencia(grupo.time, ev.time) <= 15) {
                    grupo.options.push(...ev.options);
                    grupo.buttons.push(...ev.buttons);
                    if (ev.title.length > grupo.title.length) grupo.title = ev.title;
                    if (ev.time < grupo.time) grupo.time = ev.time;
                    if (!grupo.image && ev.image) grupo.image = ev.image; // Heredar imagen si no hay una
                    if (ev.source === 'alangulotv' && ev.image) grupo.image = ev.image; // Priorizar imagen de alangulotv
                    encontrado = true;
                    break;
                }
            }
            if (!encontrado) {
                agrupados.push({ ...ev, options: [...ev.options], buttons: [...ev.buttons] });
            }
        }
        
        // --- REGLAS DE IMAGEN PERSONALIZADA ---
        for (const grupo of agrupados) {
            const linkDomain = alanGuloConfig.linkDomain;
            if (Array.isArray(grupo.buttons) && grupo.buttons.some(btn => btn && btn.trim().toUpperCase() === 'LIGA1MAX')) {
                grupo.image = 'https://a.espncdn.com/combiner/i?img=%2Fi%2Fleaguelogos%2Fsoccer%2F500%2F1813.png';
            } else if (grupo.title && grupo.title.toUpperCase().includes('F1')) {
                grupo.image = `https://${linkDomain}/f1`;
            } else if (grupo.title && grupo.title.toLowerCase().includes('copa argentina')) {
                grupo.image = `https://${linkDomain}/copaargentina`;
            } else if (grupo.title && grupo.title.toLowerCase().includes('primera b metropolitana')) {
                grupo.image = 'https://images.fotmob.com/image_resources/logo/leaguelogo/9213.png';
            } else if (grupo.title && grupo.title.toLowerCase().includes('mundial de clubes')) {
                grupo.image = `https://${linkDomain}/copamundialdeclubes`;
            } else if (grupo.title && grupo.title.toUpperCase().includes('UFC')) {
                grupo.image = 'https://i.ibb.co/chR144x9/boxing-glove-emoji-clipart-md.png';
            } else if (grupo.title && grupo.title.toLowerCase().includes('boxeo')) {
                grupo.image = `https://${linkDomain}/boxeo`;
            }
            if (!grupo.image) {
                grupo.image = 'https://cdn-icons-png.flaticon.com/512/9192/9192710.png';
            }
        }

        return res.status(200).json(agrupados);

    } catch (error) {
        console.error('Error en la función principal:', error);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
};
