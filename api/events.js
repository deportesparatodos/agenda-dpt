import fetch from 'node-fetch';

const DEFAULT_IMAGE = 'https://i.ibb.co/dHPWxr8/depete.jpg';

/**
 * Función para obtener eventos desde ppvs.su
 */
async function fetchPpvsSuEvents() {
    try {
        console.log('Fetching PPVS.su eventos...');
        
        const response = await fetch('https://ppvs.su/api/streams', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            },
            timeout: 15000
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log(`PPVS.su: Respuesta recibida con ${data.streams ? data.streams.length : 0} streams`);
        
        if (!data.streams || !Array.isArray(data.streams)) {
            console.warn('PPVS.su: No se encontraron streams en la respuesta');
            return [];
        }
        
        const events = [];
        
        // Procesar cada categoría de streams
        data.streams.forEach(category => {
            if (!category.streams || !Array.isArray(category.streams)) {
                return;
            }
            
            category.streams.forEach(stream => {
                try {
                    // Convertir timestamps a fechas legibles
                    const startDate = new Date(stream.starts_at * 1000);
                    const endDate = new Date(stream.ends_at * 1000);
                    const now = new Date();
                    
                    // Determinar si está en vivo
                    const isLive = now >= startDate && now <= endDate;
                    const status = isLive ? 'En vivo' : 'Próximo';
                    
                    // Formatear hora
                    const time = isLive ? 'En vivo' : startDate.toLocaleTimeString('es-AR', { 
                        hour: '2-digit', 
                        minute: '2-digit', 
                        timeZone: 'America/Argentina/Buenos_Aires', 
                        hour12: false 
                    });
                    
                    // Construir el evento
                    const event = {
                        time: time,
                        title: stream.name || 'Sin título',
                        options: [stream.iframe || ''], // URL del iframe
                        buttons: [stream.tag || 'CANAL'], // Etiqueta del canal
                        category: category.category || 'Otros',
                        language: 'Desconocido', // PPVS.su no parece incluir idioma
                        date: startDate.toISOString().split('T')[0],
                        source: 'ppvs.su',
                        image: stream.poster || DEFAULT_IMAGE,
                        status: status,
                        viewers: stream.viewers || '0',
                        starts_at: stream.starts_at,
                        ends_at: stream.ends_at,
                        always_live: stream.always_live || 0
                    };
                    
                    // Solo agregar si tiene iframe válido
                    if (stream.iframe && stream.iframe.trim() !== '') {
                        events.push(event);
                    }
                    
                } catch (error) {
                    console.error(`Error procesando stream "${stream.name}":`, error);
                }
            });
        });
        
        console.log(`PPVS.su: ${events.length} eventos procesados exitosamente`);
        return events;
        
    } catch (error) {
        console.error('Error al obtener eventos de ppvs.su:', error);
        
        // Si es error 403, intentar con headers más básicos
        if (error.message.includes('403')) {
            console.log('Reintentando con headers básicos...');
            try {
                const response = await fetch('https://ppvs.su/api/streams', {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; API Client)',
                        'Accept': 'application/json'
                    },
                    timeout: 10000
                });
                
                if (response.ok) {
                    const data = await response.json();
                    console.log('Reintento exitoso con headers básicos');
                    // Procesar la respuesta aquí también si es necesario
                    return [];
                }
            } catch (retryError) {
                console.error('Reintento también falló:', retryError);
            }
        }
        
        return [];
    }
}

/**
 * Función principal de la API
 */
export default async (req, res) => {
    // Headers CORS
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
        console.log('Iniciando obtención de eventos desde PPVS.su...');
        
        const events = await fetchPpvsSuEvents();
        
        if (events.length === 0) {
            console.warn('No se obtuvieron eventos de PPVS.su');
            return res.status(200).json([]);
        }
        
        // Filtrar y ordenar eventos
        const filteredEvents = events
            .filter(event => event.options && event.options.length > 0 && event.options[0])
            .sort((a, b) => {
                // Primero eventos en vivo, luego por hora de inicio
                if (a.status === 'En vivo' && b.status !== 'En vivo') return -1;
                if (b.status === 'En vivo' && a.status !== 'En vivo') return 1;
                return a.starts_at - b.starts_at;
            });
        
        console.log(`Devolviendo ${filteredEvents.length} eventos válidos`);
        return res.status(200).json(filteredEvents);
        
    } catch (error) {
        console.error('Error en la función principal:', error);
        return res.status(500).json({ 
            error: 'Error interno del servidor',
            details: error.message 
        });
    }
};