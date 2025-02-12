require('dotenv').config();

class Connector {

    constructor(task_id, logger){
        this.task_id = task_id
        this.logger = logger
    }

    async fetchCBMTaskDetails() {
        try {
            const cbmTaskUrl = `${process.env.CBM_BASE_URL}/api/v3/items/${this.task_id}`;
            const cbmTaskResponse = await fetch(cbmTaskUrl, {
                headers: {
                    Authorization: `Basic ${process.env.CBM_API_KEY}`,
                    ContentType: 'application/json'
                }
            });
    
            if (!cbmTaskResponse.ok) {
                throw new Error(`Failed to fetch CBM task: ${cbmTaskResponse.status}`);
            }
    
            this.task = await cbmTaskResponse.json()
            return this.task;

        } catch (error) {
            logger.error('Error fetching CBM task details:', error);
            throw error;
        }
    }

    async fetchPreviewMetadata(template_name) {
        try {
            const params = new URLSearchParams({
                task_id: this.task_id
            });
    
            if (template_name?.trim()) {
                params.append('template_name', template_name.trim());
            }
    
            const preview_metadata_url = `${process.env.CBM_BASE_URL}/dtas/preview-metadata.spr?${params.toString()}`;
    
            const response = await fetch(preview_metadata_url, {
                headers: {
                    Authorization: `Basic ${process.env.CBM_API_KEY}`,
                    ContentType: 'application/json'
                }
            });
    
            if (!response.ok) {
                throw new Error(`Failed to fetch preview metadata: ${response.status}`);
            }
    
            return await response.json();
    
        } catch (error) {
            logger.error('Error fetching Preview Metadata:', error);
            throw error;
        }
    }

    async fetchTrackerDetails() {
        try {
            if(!this.task) await fetchCBMTaskDetails();

            const tracker_id = this.task.tracker.id;
            
            const cbmTrackerUrl = `${process.env.CBM_BASE_URL}/api/v3/trackers/${tracker_id}`;
        
            const cbmTrackerResponse = await fetch(cbmTrackerUrl, {
                headers: {
                    Authorization: `Basic ${process.env.CBM_API_KEY}`,
                    ContentType: 'application/json'
                }
            });
        
            const trackerJson = await cbmTrackerResponse.json();
        
            if (cbmTrackerResponse.status !== 200) {
                throw new Error(`Failed to fetch tracker: ${cbmTrackerResponse.status}`);
            }
        
            return trackerJson;
        } catch (error) {
            logger.error('Error fetching tracker data:', error);
            throw error;
        }
    }
}

module.exports = Connector;