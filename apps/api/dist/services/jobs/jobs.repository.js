export class JobsRepository {
    records = [];
    async saveTriage(record) {
        this.records.unshift(record);
        if (this.records.length > 200) {
            this.records.pop();
        }
        return record;
    }
    async getRecent(limit = 20) {
        return this.records.slice(0, limit);
    }
    clearForTests() {
        this.records.length = 0;
    }
    async getById(id) {
        const found = this.records.find((item) => item.id === id);
        return found ?? null;
    }
}
export const jobsRepository = new JobsRepository();
