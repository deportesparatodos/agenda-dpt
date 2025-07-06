import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

/**
 * NEW: Detecta dinámicamente el dominio base de AlanGuloTV siguiendo redirecciones.
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

/**
 * Función para hacer scraping de alangulotv usando Cheerio
 * SOLO extrae los links tal como vienen de la página, sin procesar ni modificar.
 */
async function fetchAlanGuloTVEvents(config) {
    const { agendaUrl } = config;
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
        // Buscar contenedores de partidos
        $('.match-container').each((index, element) => {
            try {
                const $container = $(element);
                // Extraer la hora
                const timeText = $container.find('.time').text().trim();
                const time = timeText || '00:00';
                // Extraer nombres de equipos
                const teamNames = [];
                $container.find('.team-name').each((i, teamEl) => {
                    teamNames.push($(teamEl).text().trim());
                });
                const team1 = teamNames[0] || '';
                const team2 = teamNames[1] || '';
                // Crear título principal
                let title = '';
                if (team1 && team2) {
                    title = `${team1} vs ${team2}`;
                } else if (team1) {
                    title = team1;
                } else {
                    title = 'Evento sin título';
                }
                // Buscar el contenedor de enlaces (siguiente elemento hermano)
                const $linksContainer = $container.next('.links-container');
                if ($linksContainer.length > 0) {
                    $linksContainer.find('.link-button, a').each((i, linkEl) => {
                        const $link = $(linkEl);
                        const href = $link.attr('href');
                        let buttonName = $link.text().trim();
                        if (!buttonName) buttonName = 'CANAL';
                        if (href) {
                            events.push({
                                time: time,
                                title: title,
                                link: href, // Link tal como viene de la página
                                button: buttonName,
                                category: 'Deportes',
                                language: 'Español',
                                date: new Date().toISOString().split('T')[0],
                                source: 'alangulotv'
                            });
                        }
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
        return [];
    }
}

/**
 * Método fallback usando regex para parsear AlanGuloTV
 * MODIFIED: Acepta config para usar URLs dinámicas.
 */
async function fetchAlanGuloTVFallback(config) {
    const { agendaUrl, baseOrigin } = config;

    const response = await fetch(agendaUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const html = await response.text();
    const events = [];
    
    // Regex para encontrar match-container y links-container
    const containerRegex = /<div class="match-container"[^>]*>(.*?)<\/div>\s*<div class="links-container"[^>]*>(.*?)<\/div>/gs;
    let match;
    
    while ((match = containerRegex.exec(html)) !== null) {
        const matchHTML = match[1];
        const linksHTML = match[2];
        
        try {
            // Extraer hora
            const timeMatch = matchHTML.match(/<span class="time"[^>]*>([^<]+)<\/span>/);
            const time = timeMatch ? timeMatch[1].trim() : '00:00';
            
            // Extraer equipos/títulos
            const teamMatches = [...matchHTML.matchAll(/<span class="team-name"[^>]*>([^<]+)<\/span>/g)];
            const team1 = teamMatches[0] ? teamMatches[0][1].trim() : '';
            const team2 = teamMatches[1] ? teamMatches[1][1].trim() : '';
            
            // Crear título
            let title = '';
            if (team1 && team2) {
                title = `${team1} vs ${team2}`;
            } else if (team1) {
                title = team1;
            } else {
                title = 'Evento sin título';
            }
            
            // Extraer enlaces
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
    // Configurar CORS
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

        // MODIFIED: Obtener configuración dinámica para AlanGuloTV
        const alanGuloConfig = await getDynamicAlanGuloConfig();
        
        // Obtener eventos de ambas fuentes en paralelo with timeout
        const [streamTpEvents, alanGuloEvents] = await Promise.allSettled([
            Promise.race([
                fetchStreamTpGlobalEvents(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout StreamTpGlobal')), 15000))
            ]),
            Promise.race([
                fetchAlanGuloTVEvents(alanGuloConfig), // MODIFIED: Pasar config
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout AlanGuloTV')), 20000))
            ])
        ]);

        // Procesar resultados
        const streamEvents = streamTpEvents.status === 'fulfilled' ? streamTpEvents.value : [];
        const alanEvents = alanGuloEvents.status === 'fulfilled' ? alanGuloEvents.value : [];
        
        if (streamTpEvents.status === 'rejected') {
            console.error('StreamTpGlobal falló:', streamTpEvents.reason);
        }
        if (alanGuloEvents.status === 'rejected') {
            console.error('AlanGuloTV falló:', alanGuloEvents.reason);
        }

        // Combinar todos los eventos
        const allEvents = [...streamEvents, ...alanEvents];
        console.log(`Total eventos combinados: ${allEvents.length}`);
        
        if (allEvents.length === 0) {
            console.warn('No se obtuvieron eventos de ninguna fuente');
            return res.status(200).json([]);
        }
        
        // Procesar eventos: ajustar horarios y agrupar por título y hora
        const eventMap = new Map();
        allEvents.forEach(event => {
            // MODIFIED: Forzar imagen MLB con URL dinámica
            if (event.title && event.title.toUpperCase().includes('MLB')) {
                event.image = `https://${alanGuloConfig.linkDomain}/mlb`;
            }
            // Solo procesar eventos que tengan tiempo válido
            if (event.time) {
                // Extraer hora y minuto
                const timeParts = event.time.split(':');
                if (timeParts.length >= 2) {
                    const hour = parseInt(timeParts[0]);
                    const minute = parseInt(timeParts[1]);
                    // Sumar 2 horas (solo para eventos de StreamTpGlobal)
                    let newHour = hour;
                    if (event.source === 'streamtpglobal') {
                        newHour = hour + 2;
                        if (newHour >= 24) newHour -= 24;
                        event.time = `${String(newHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                    } else {
                        // Para alangulotv, NO modificar la hora
                        event.time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                    }
                }
            }
            // El estado se calcula SIEMPRE usando la hora que se muestra (event.time ya ajustada)
            const key = `${event.title || 'Sin título'}__${event.time || '00:00'}__${event.source}`;
            if (!eventMap.has(key)) {
                let buttonArr = [];
                if (event.source === 'streamtpglobal' && event.link) {
                    // Extraer el valor después del igual en el parámetro stream
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
                // Si ya existe, agregar más opciones y botones
                const existing = eventMap.get(key);
                if (event.link && !existing.options.includes(event.link)) {
                    existing.options.push(event.link);
                    if (event.button) existing.buttons.push(event.button);
                }
                // Si el evento de alangulotv tiene imagen, usar esa imagen para la card unificada
                if (event.source === 'alangulotv' && event.image) {
                    existing.image = event.image;
                }
                // Si no tiene imagen y este evento sí, agregarla (fallback)
                if (!existing.image && event.image) {
                    existing.image = event.image;
                }
            }
        });

        // Alinear y corregir botones especiales
        let adaptedEvents = Array.from(eventMap.values()).map(event => {
            // Asegurar que buttons y options tengan la misma longitud
            if (!event.buttons) event.buttons = [];
            while (event.buttons.length < event.options.length) {
                event.buttons.push(undefined);
            }
            // Corregir textos especiales y nunca dejar 'OPCION' para los links especiales
            event.options.forEach((opt, idx) => {
                if (opt === `${alanGuloConfig.baseOrigin}/canal/multi-f1/`) {
                    event.buttons[idx] = 'MULTICAM (ALANGULOTV)';
                }
                if (opt === 'https://alangulo-dashboard-f1.vercel.app/') {
                    event.buttons[idx] = 'TELEMETRIA OFICIAL';
                }
            });
            // Para eventos de streamtpglobal: si no hay nombre, usar el valor del parámetro stream del link
            if (event.source === 'streamtpglobal') {
                event.options.forEach((opt, idx) => {
                    if (!event.buttons[idx] || event.buttons[idx].toUpperCase() === 'CANAL' || event.buttons[idx].toUpperCase() === 'OPCION') {
                        if (typeof opt === 'string') {
                            const match = opt.match(/[?&]stream=([^&#]+)/i);
                            if (match && match[1]) {
                                event.buttons[idx] = match[1];
                            } else {
                                // Si no hay parámetro stream, usar el último segmento del link
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
            // Si algún botón sigue vacío, usar el canal detectado del link si es posible
            event.options.forEach((opt, idx) => {
                if (!event.buttons[idx] || event.buttons[idx].toUpperCase() === 'CANAL' || event.buttons[idx].toUpperCase() === 'OPCION') {
                    if (typeof opt === 'string') {
                        try {
                             const urlObj = new URL(opt, 'https://dummy.base');
                             const channel = urlObj.searchParams.get('channel');
                             if (channel) {
                                 event.buttons[idx] = channel;
                             } else {
                                 // Si no hay channel, usar el último segmento del path
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
            // Eliminar botones y opciones cuyo link sea undefined o null
            const filtered = event.options
                .map((opt, idx) => ({ opt, btn: event.buttons[idx] }))
                .filter(pair => pair.opt && pair.opt !== 'undefined' && pair.opt !== 'null');
            event.options = filtered.map(pair => pair.opt);
            event.buttons = filtered.map(pair => pair.btn);
            return event;
        });
        // Eliminar eventos sin botones/canales válidos
        adaptedEvents = adaptedEvents.filter(ev => Array.isArray(ev.options) && ev.options.length > 0 && Array.isArray(ev.buttons) && ev.buttons.length > 0);

        // REMOVED: El bloque de reemplazo manual de dominios ya no es necesario.

        // --- AGRUPACIÓN AVANZADA DE EVENTOS (idéntica al frontend, ahora con tolerancia de 15min) ---
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
                // Unificar si equipos coinciden y la diferencia de horario es <= 15min
                if (equiposCoinciden(grupo, ev) && minutosDiferencia(grupo.time, ev.time) <= 15) {
                    grupo.options.push(...ev.options);
                    grupo.buttons.push(...ev.buttons);
                    if (ev.title.length > grupo.title.length) {
                        grupo.title = ev.title;
                    }
                    // El horario del grupo será el más temprano
                    if (ev.time < grupo.time) {
                        grupo.time = ev.time;
                    }
                    encontrado = true;
                    break;
                }
                // Fallback: similitud ≥ 0.75 y diferencia de horario <= 15min
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
        // Asignar imagen de alangulotv solo después de agrupar
        for (const grupo of agrupados) {
            for (const ev of adaptedEvents) {
                if (minutosDiferencia(grupo.time, ev.time) <= 15 && equiposCoinciden(grupo, ev) && ev.source === 'alangulotv' && ev.image) {
                    grupo.image = ev.image;
                    break;
                }
            }
            // Imagen Liga Pro Ecuador: si el título inicia con 'Primera A' o algún canal es ECDF
            const ligaProImg = 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/Football_of_Ecuador_-_Liga_Pro_logo_%28mini%29.svg/2048px-Football_of_Ecuador_-_Liga_Pro_logo_%28mini%29.svg.png';
            if (grupo.title && grupo.title.trim().toLowerCase().startsWith('primera a')) {
                grupo.image = ligaProImg;
            } else if (Array.isArray(grupo.buttons) && grupo.buttons.some(btn => btn && btn.trim().toUpperCase() === 'ECDF')) {
                grupo.image = ligaProImg;
            } else if (Array.isArray(grupo.options) && grupo.options.some(opt => typeof opt === 'string' && opt.toLowerCase().includes('ecdf'))) {
                grupo.image = ligaProImg;
            }
        }

        // --- REGLAS DE IMAGEN PERSONALIZADA SEGÚN TU PEDIDO ---
        for (const grupo of agrupados) {
             // MODIFIED: URLs de imágenes personalizadas ahora usan el dominio dinámico
            const linkDomain = alanGuloConfig.linkDomain;
            // 1. Si algún botón es LIGA1MAX
            if (Array.isArray(grupo.buttons) && grupo.buttons.some(btn => btn && btn.trim().toUpperCase() === 'LIGA1MAX')) {
                grupo.image = 'https://a.espncdn.com/combiner/i?img=%2Fi%2Fleaguelogos%2Fsoccer%2F500%2F1813.png';
            }
            // 2. Si el título contiene F1
            else if (grupo.title && grupo.title.toUpperCase().includes('F1')) {
                grupo.image = `https://${linkDomain}/f1`;
            }
            // 3. Si el título contiene Copa Argentina
            else if (grupo.title && grupo.title.toLowerCase().includes('copa argentina')) {
                grupo.image = `https://${linkDomain}/copaargentina`;
            }
            // 4. Si el título contiene Primera B Metropolitana
            else if (grupo.title && grupo.title.toLowerCase().includes('primera b metropolitana')) {
                grupo.image = 'https://images.fotmob.com/image_resources/logo/leaguelogo/9213.png';
            }
            // 5. Si el título contiene Mundial de Clubes
            else if (grupo.title && grupo.title.toLowerCase().includes('mundial de clubes')) {
                grupo.image = `https://${linkDomain}/copamundialdeclubes`;
            }
            // 6. Si el título contiene UFC
            else if (grupo.title && grupo.title.toUpperCase().includes('UFC')) {
                grupo.image = 'https://i.ibb.co/chR144x9/boxing-glove-emoji-clipart-md.png';
            }
            // 7. Si el título contiene Boxeo
            else if (grupo.title && grupo.title.toLowerCase().includes('boxeo')) {
                grupo.image = `https://${linkDomain}/boxeo`;
            }
            // 8. Si no tiene imagen, poner imagen por defecto
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