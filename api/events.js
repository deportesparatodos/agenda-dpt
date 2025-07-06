import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

/**
 * Detecta dinámicamente el dominio base de AlanGuloTV siguiendo redirecciones.
 * Esto evita tener que cambiar manualmente los dominios cuando expiran.
 */
async function getDynamicAlanGuloConfig() {
    const mainUrl = 'https://alangulotv.live';
    try {
        const response = await fetch(mainUrl, {
            redirect: 'follow',
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const finalUrl = new URL(response.url);
        const baseDomain = finalUrl.hostname; // e.g., alangulotv.space
        const linkDomain = `p.${baseDomain}`;   // e.g., p.alangulotv.space
        const agendaUrl = `https://${baseDomain}/agenda-2/`;
        const baseOrigin = `https://${baseDomain}`;

        console.log(`Dominio de AlanGuloTV detectado: ${baseDomain}`);

        return { baseDomain, linkDomain, agendaUrl, baseOrigin };
    } catch (error) {
        console.error('No se pudo obtener el dominio dinámico de AlanGuloTV. Usando valores por defecto.', error);
        // Fallback a los últimos dominios conocidos para no romper la API
        const baseDomain = 'alangulotv.space';
        const linkDomain = `p.${baseDomain}`;
        const agendaUrl = `https://${baseDomain}/agenda-2/`;
        const baseOrigin = `https://${baseDomain}`;
        return { baseDomain, linkDomain, agendaUrl, baseOrigin };
    }
}


function adjustTimeZone(time, date) {
    if (!time || !date) return time || '00:00';

    try {
        const [hour, minute] = time.split(':').map(Number);
        
        if (isNaN(hour) || isNaN(minute)) return time;

        // Ajustar hora: +2 horas desde el horario de Lima
        let adjustedHour = hour + 2;
        
        // Manejar el cambio de día si es necesario
        if (adjustedHour >= 24) {
            adjustedHour -= 24;
        }

        // Formato de dos dígitos para hora y minutos
        return `${String(adjustedHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    } catch (error) {
        console.error('Error al ajustar zona horaria:', error);
        return time;
    }
}

// Devuelve SIEMPRE el estado 'raw' (sin calcular) y deja que el frontend lo calcule
function determineEventStatus(eventTime, eventDate) {
    return null; // No calcular aquí, lo hará el frontend
}

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
            source: 'streamtpglobal'
        }));
    } catch (error) {
        console.error('Error al obtener eventos de StreamTpGlobal:', error);
        return [];
    }
}

// ANTERIOR: La lógica de mapeo de canales (channelsGrouped) y las funciones de normalización han sido eliminadas
// ya que la nueva lógica para AlanGuloTV no las necesita.

/**
 * Función para hacer scraping de alangulotv usando Cheerio
 * MODIFICADO: La lógica de procesamiento de enlaces ha sido reemplazada.
 */
async function fetchAlanGuloTVEvents(config) {
    const { agendaUrl, linkDomain, baseOrigin } = config;
    // Cargar canales.json de forma síncrona y segura
    const canalesPath = path.join(process.cwd(), 'api', 'canales.json');
    let canales = {};
    try {
        canales = JSON.parse(fs.readFileSync(canalesPath, 'utf8'));
    } catch (e) {
        console.error('No se pudo cargar canales.json:', e);
        canales = { canales: {} };
    }

    try {
        console.log(`Fetching AlanGuloTV eventos desde ${agendaUrl}...`);
        
        const response = await fetch(agendaUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'es-ES,es;q=0.8,en-US;q=0.5,en;q=0.3',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1',
            },
            timeout: 15000
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const html = await response.text();
        const $ = cheerio.load(html);
        const events = [];
        
        $('.match-container').each((index, element) => {
            try {
                const $container = $(element);
                let imageUrl = '';
                const $eventLogo = $container.find('img.event-logo');
                if ($eventLogo.length > 0) {
                    imageUrl = $eventLogo.attr('src') || '';
                } else {
                    const $teamLogo = $container.find('img.team-logo');
                    if ($teamLogo.length > 0) {
                        imageUrl = $teamLogo.attr('src') || '';
                    }
                }
                if (imageUrl && imageUrl.startsWith('/')) {
                    imageUrl = `https://${linkDomain}${imageUrl}`;
                }

                const timeText = $container.find('.time').text().trim();
                const time = timeText || '00:00';
                
                const teamNames = [];
                $container.find('.team-name').each((i, teamEl) => {
                    teamNames.push($(teamEl).text().trim());
                });
                const team1 = teamNames[0] || '';
                const team2 = teamNames[1] || '';
                
                let title = '';
                if (team1 && team2) {
                    title = `${team1} vs ${team2}`;
                } else if (team1) {
                    title = team1;
                } else {
                    title = 'Evento sin título';
                }

                if (title.toUpperCase().includes('MLB')) {
                    imageUrl = `https://${linkDomain}/mlb`;
                }

                const $linksContainer = $container.next('.links-container');
                const links = [];
                if ($linksContainer.length > 0) {
                    
                    // --- NUEVA LÓGICA DE PROCESAMIENTO DE LINKS ---
                    $linksContainer.find('.link-button, a').each((i, linkEl) => {
                        const $link = $(linkEl);
                        const href = $link.attr('href');
                        const buttonName = $link.text().trim() || 'CANAL';
                        let finalLink = null;

                        if (href) {
                            // 1. Extraer la última parte del path del href. Ej: /canal/espn-co/ -> espn-co
                            const pathParts = href.split('/').filter(part => part.length > 0);
                            const linkKey = pathParts[pathParts.length - 1];

                            // 2. Buscar si esa clave existe en el archivo canales.json
                            if (linkKey && canales.canales[linkKey]) {
                                const channelData = canales.canales[linkKey];
                                
                                // 3. Obtener el primer link disponible de ese canal (ej: el valor de "repro1")
                                const firstAvailableKey = Object.keys(channelData)[0];
                                if (firstAvailableKey) {
                                    finalLink = channelData[firstAvailableKey];
                                }
                            }
                        }

                        // 4. Solo si se encontró un link final en el JSON, se agrega al evento.
                        if (finalLink) {
                            links.push({
                                name: buttonName,
                                url: finalLink
                            });
                        }
                    });
                    // --- FIN DE LA NUEVA LÓGICA ---
                }
                
                if (links.length > 0) {
                    links.forEach(linkObj => {
                        events.push({
                            time: time,
                            title: title,
                            link: linkObj.url,
                            button: linkObj.name,
                            category: 'Deportes',
                            language: 'Español',
                            date: new Date().toISOString().split('T')[0],
                            source: 'alangulotv',
                            image: imageUrl
                        });
                    });
                }
            } catch (error) {
                console.error('Error procesando evento AlanGuloTV:', error);
            }
        });
        
        console.log(`AlanGuloTV: ${events.length} eventos obtenidos`);
        return events;
        
    } catch (error) {
        console.error('Error al obtener eventos de AlanGuloTV:', error);
        
        try {
            console.log('Intentando método fallback con regex...');
            return await fetchAlanGuloTVFallback(config);
        } catch (fallbackError) {
            console.error('Método fallback también falló:', fallbackError);
            return [];
        }
    }
}

/**
 * Método fallback usando regex para parsear AlanGuloTV
 * (Sin cambios, ya que la modificación principal fue en la lógica de Cheerio)
 */
async function fetchAlanGuloTVFallback(config) {
    const { agendaUrl, baseOrigin } = config;

    const response = await fetch(agendaUrl, {
        headers:
         {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const html = await response.text();
    const events = [];
    
    const containerRegex = /<div class="match-container"[^>]*>(.*?)<\/div>\s*<div class="links-container"[^>]*>(.*?)<\/div>/gs;
    let match;
    
    while ((match = containerRegex.exec(html)) !== null) {
        const matchHTML = match[1];
        const linksHTML = match[2];
        
        try {
            const timeMatch = matchHTML.match(/<span class="time"[^>]*>([^<]+)<\/span>/);
            const time = timeMatch ? timeMatch[1].trim() : '00:00';
            
            const teamMatches = [...matchHTML.matchAll(/<span class="team-name"[^>]*>([^<]+)<\/span>/g)];
            const team1 = teamMatches[0] ? teamMatches[0][1].trim() : '';
            const team2 = teamMatches[1] ? teamMatches[1][1].trim() : '';
            
            let title = '';
            if (team1 && team2) {
                title = `${team1} vs ${team2}`;
            } else if (team1) {
                title = team1;
            } else {
                title = 'Evento sin título';
            }
            
            const linkMatches = [...linksHTML.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g)];
            
            linkMatches.forEach(linkMatch => {
                const href = linkMatch[1];
                const linkText = linkMatch[2].trim();
                
                if (href && linkText) {
                    const fullUrl = href.startsWith('/') 
                        ? `${baseOrigin}${href}` 
                        : href;
                    const urlWithStream = `${fullUrl}?stream=${encodeURIComponent(linkText)}`;
                    
                    events.push({
                        time: time,
                        title: title,
                        link: urlWithStream,
                        category: 'Deportes',
                        language: 'Español',
                        date: new Date().toISOString().split('T')[0],
                        source: 'alangulotv'
                    });
                }
            });
        } catch (error) {
            console.error('Error en fallback regex:', error);
        }
    }
    
    return events;
}

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

        const alanGuloConfig = await getDynamicAlanGuloConfig();
        
        const [streamTpEvents, alanGuloEvents] = await Promise.allSettled([
            Promise.race([
                fetchStreamTpGlobalEvents(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout StreamTpGlobal')), 15000))
            ]),
            Promise.race([
                fetchAlanGuloTVEvents(alanGuloConfig),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout AlanGuloTV')), 20000))
            ])
        ]);

        const streamEvents = streamTpEvents.status === 'fulfilled' ? streamTpEvents.value : [];
        const alanEvents = alanGuloEvents.status === 'fulfilled' ? alanGuloEvents.value : [];
        
        if (streamTpEvents.status === 'rejected') {
            console.error('StreamTpGlobal falló:', streamTpEvents.reason);
        }
        if (alanGuloEvents.status === 'rejected') {
            console.error('AlanGuloTV falló:', alanGuloEvents.reason);
        }

        const allEvents = [...streamEvents, ...alanEvents];
        console.log(`Total eventos combinados: ${allEvents.length}`);
        
        if (allEvents.length === 0) {
            console.warn('No se obtuvieron eventos de ninguna fuente');
            return res.status(200).json([]);
        }
        
        const eventMap = new Map();
        allEvents.forEach(event => {
            if (event.title && event.title.toUpperCase().includes('MLB')) {
                event.image = `https://${alanGuloConfig.linkDomain}/mlb`;
            }
            if (event.time) {
                const timeParts = event.time.split(':');
                if (timeParts.length >= 2) {
                    const hour = parseInt(timeParts[0]);
                    const minute = parseInt(timeParts[1]);
                    let newHour = hour;
                    if (event.source === 'streamtpglobal') {
                        newHour = hour + 2;
                        if (newHour >= 24) newHour -= 24;
                        event.time = `${String(newHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                    } else {
                        event.time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                    }
                }
            }
            const key = `${event.title || 'Sin título'}__${event.time || '00:00'}__${event.source}`;
            if (!eventMap.has(key)) {
                let buttonArr = [];
                if (event.source === 'streamtpglobal' && event.link) {
                    const match = event.link.match(/[?&]stream=([^&#]+)/i);
                    buttonArr = [match ? match[1].toUpperCase() : 'CANAL'];
                } else if (event.button) {
                    buttonArr = [event.button];
                } else {
                    buttonArr = [];
                }
                eventMap.set(key, {
                    time: event.time || '00:00',
                    title: event.title || 'Sin título',
                    options: [event.link],
                    buttons: buttonArr,
                    category: event.category || 'Sin categoría',
                    language: event.language || 'Desconocido',
                    date: event.date || new Date().toISOString().split('T')[0],
                    source: event.source || 'unknown',
                    image: event.image || ''
                });
            } else {
                const existing = eventMap.get(key);
                if (event.link && !existing.options.includes(event.link)) {
                    existing.options.push(event.link);
                    if (event.button) existing.buttons.push(event.button);
                }
                if (event.source === 'alangulotv' && event.image) {
                    existing.image = event.image;
                }
                if (!existing.image && event.image) {
                    existing.image = event.image;
                }
            }
        });

        let adaptedEvents = Array.from(eventMap.values()).map(event => {
            if (!event.buttons) event.buttons = [];
            while (event.buttons.length < event.options.length) {
                event.buttons.push(undefined);
            }
            event.options.forEach((opt, idx) => {
                if (opt === `${alanGuloConfig.baseOrigin}/canal/multi-f1/`) {
                    event.buttons[idx] = 'MULTICAM (ALANGULOTV)';
                }
                if (opt === 'https://alangulo-dashboard-f1.vercel.app/') {
                    event.buttons[idx] = 'TELEMETRIA OFICIAL';
                }
            });
            if (event.source === 'streamtpglobal') {
                event.options.forEach((opt, idx) => {
                    if (!event.buttons[idx] || event.buttons[idx].toUpperCase() === 'CANAL' || event.buttons[idx].toUpperCase() === 'OPCION') {
                        if (typeof opt === 'string') {
                            const match = opt.match(/[?&]stream=([^&#]+)/i);
                            if (match && match[1]) {
                                event.buttons[idx] = match[1];
                            } else {
                                try {
                                    const urlObj = new URL(opt);
                                    const last = urlObj.pathname.split('/').filter(Boolean).pop();
                                    event.buttons[idx] = last || 'ENLACE';
                                } catch {
                                    event.buttons[idx] = 'ENLACE';
                                }
                            }
                        } else {
                            event.buttons[idx] = 'ENLACE';
                        }
                    }
                });
            }
            event.options.forEach((opt, idx) => {
                if (!event.buttons[idx] || event.buttons[idx].toUpperCase() === 'CANAL' || event.buttons[idx].toUpperCase() === 'OPCION') {
                    if (typeof opt === 'string') {
                        try {
                             const urlObj = new URL(opt, 'https://dummy.base');
                             const channel = urlObj.searchParams.get('channel');
                             if (channel) {
                                 event.buttons[idx] = channel;
                             } else {
                                 const last = urlObj.pathname.split('/').filter(Boolean).pop();
                                 event.buttons[idx] = last || 'ENLACE';
                             }
                        } catch {
                             event.buttons[idx] = 'ENLACE';
                        }
                    } else {
                        event.buttons[idx] = 'ENLACE';
                    }
                }
            });
            const filtered = event.options
                .map((opt, idx) => ({ opt, btn: event.buttons[idx] }))
                .filter(pair => pair.opt && pair.opt !== 'undefined' && pair.opt !== 'null');
            event.options = filtered.map(pair => pair.opt);
            event.buttons = filtered.map(pair => pair.btn);
            return event;
        });
        adaptedEvents = adaptedEvents.filter(ev => Array.isArray(ev.options) && ev.options.length > 0 && Array.isArray(ev.buttons) && ev.buttons.length > 0);

        function quitarPrefijoTitulo(titulo) {
            if (!titulo) return '';
            const partes = titulo.split(': ');
            return partes.length > 1 ? partes.slice(1).join(': ').trim() : titulo.trim();
        }
        function normalizarTexto(txt) {
            return txt.toLowerCase().replace(/[^a-z0-9áéíóúüñ\s]/gi, '').replace(/\s+/g, ' ').trim();
        }
        function similitudPalabras(a, b) {
            if (!a || !b) return 0;
            const setA = new Set(normalizarTexto(a).split(' '));
            const setB = new Set(normalizarTexto(b).split(' '));
            const inter = new Set([...setA].filter(x => setB.has(x)));
            const union = new Set([...setA, ...setB]);
            return union.size === 0 ? 0 : inter.size / union.size;
        }
        function extraerEquipos(titulo) {
            const sinPrefijo = quitarPrefijoTitulo(titulo);
            const vsMatch = sinPrefijo.match(/(.+?)\s+vs\.?\s+(.+)/i);
            if (vsMatch) {
                const norm = s => s.toLowerCase().normalize('NFD').replace(/[\'’`´]/g, "'").replace(/[\u0300-\u036f]/g, '').replace(/\b(fc|old boys|club|deportivo|cd|cf|ac|sc|ca|athletic|united|city|sporting|real|club atlético|atlético|atletico|the|los|las|el|la|de|del|y|and)\b/gi, '').replace(/[^a-z0-9']/g, '').trim();
                return [norm(vsMatch[1]), norm(vsMatch[2])].sort();
            }
            return [sinPrefijo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9']/g, '').trim()];
        }
        function equiposCoinciden(ev1, ev2) {
            const eq1 = extraerEquipos(ev1.title);
            const eq2 = extraerEquipos(ev2.title);
            return eq1.length === eq2.length && eq1.every((e, i) => e === eq2[i]);
        }
        function minutosDiferencia(t1, t2) {
            const [h1, m1] = t1.split(':').map(Number);
            const [h2, m2] = t2.split(':').map(Number);
            return Math.abs((h1 * 60 + m1) - (h2 * 60 + m2));
        }
        const agrupados = [];
        for (const ev of adaptedEvents) {
            let encontrado = false;
            for (const grupo of agrupados) {
                if (equiposCoinciden(grupo, ev) && minutosDiferencia(grupo.time, ev.time) <= 15) {
                    grupo.options.push(...ev.options);
                    grupo.buttons.push(...ev.buttons);
                    if (ev.title.length > grupo.title.length) {
                        grupo.title = ev.title;
                    }
                    if (ev.time < grupo.time) {
                        grupo.time = ev.time;
                    }
                    encontrado = true;
                    break;
                }
                if (!encontrado && similitudPalabras(quitarPrefijoTitulo(grupo.title), quitarPrefijoTitulo(ev.title)) >= 0.75 && minutosDiferencia(grupo.time, ev.time) <= 15) {
                    grupo.options.push(...ev.options);
                    grupo.buttons.push(...ev.buttons);
                    if (ev.title.length > grupo.title.length) {
                        grupo.title = ev.title;
                    }
                    if (ev.time < grupo.time) {
                        grupo.time = ev.time;
                    }
                    encontrado = true;
                    break;
                }
            }
            if (!encontrado) {
                agrupados.push({ ...ev, options: [...ev.options], buttons: [...ev.buttons] });
            }
        }
        for (const grupo of agrupados) {
            for (const ev of adaptedEvents) {
                if (minutosDiferencia(grupo.time, ev.time) <= 15 && equiposCoinciden(grupo, ev) && ev.source === 'alangulotv' && ev.image) {
                    grupo.image = ev.image;
                    break;
                }
            }
            const ligaProImg = 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/Football_of_Ecuador_-_Liga_Pro_logo_%28mini%29.svg/2048px-Football_of_Ecuador_-_Liga_Pro_logo_%28mini%29.svg.png';
            if (grupo.title && grupo.title.trim().toLowerCase().startsWith('primera a')) {
                grupo.image = ligaProImg;
            } else if (Array.isArray(grupo.buttons) && grupo.buttons.some(btn => btn && btn.trim().toUpperCase() === 'ECDF')) {
                grupo.image = ligaProImg;
            } else if (Array.isArray(grupo.options) && grupo.options.some(opt => typeof opt === 'string' && opt.toLowerCase().includes('ecdf'))) {
                grupo.image = ligaProImg;
            }
        }

        for (const grupo of agrupados) {
            const linkDomain = alanGuloConfig.linkDomain;
            if (Array.isArray(grupo.buttons) && grupo.buttons.some(btn => btn && btn.trim().toUpperCase() === 'LIGA1MAX')) {
                grupo.image = 'https://a.espncdn.com/combiner/i?img=%2Fi%2Fleaguelogos%2Fsoccer%2F500%2F1813.png';
            }
            else if (grupo.title && grupo.title.toUpperCase().includes('F1')) {
                grupo.image = `https://${linkDomain}/f1`;
            }
            else if (grupo.title && grupo.title.toLowerCase().includes('copa argentina')) {
                grupo.image = `https://${linkDomain}/copaargentina`;
            }
            else if (grupo.title && grupo.title.toLowerCase().includes('primera b metropolitana')) {
                grupo.image = 'https://images.fotmob.com/image_resources/logo/leaguelogo/9213.png';
            }
            else if (grupo.title && grupo.title.toLowerCase().includes('mundial de clubes')) {
                grupo.image = `https://${linkDomain}/copamundialdeclubes`;
            }
            else if (grupo.title && grupo.title.toUpperCase().includes('UFC')) {
                grupo.image = 'https://i.ibb.co/chR144x9/boxing-glove-emoji-clipart-md.png';
            }
            else if (grupo.title && grupo.title.toLowerCase().includes('boxeo')) {
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
