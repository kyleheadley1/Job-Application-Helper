import { randomUUID } from "node:crypto";
import { getTrackerColor, shouldShortlist, } from "../../config/scoringPolicy.js";
import { getDb } from "../../config/mongo.js";
import { buildJobExportRow } from "../../tracker/canonicalSpreadsheet.js";
export class JobsRepository {
    async collection() {
        const db = await getDb();
        return db.collection("jobs");
    }
    fromDoc(doc) {
        const { _id, ...rest } = doc;
        return { ...rest, id: rest.id ?? _id };
    }
    upsertTrackerFields(prev, nextStatus) {
        const nextShortlist = shouldShortlist(prev.score.total, nextStatus);
        return {
            ...prev.tracker,
            statusOutcome: nextStatus,
            shortlist: nextShortlist,
            color: getTrackerColor(nextStatus, prev.score.total),
        };
    }
    async saveTriage(record) {
        const col = await this.collection();
        await col.insertOne({ ...record, _id: record.id });
        return record;
    }
    async mergeGeneratedAssets(id, generated, debugAssetGeneration) {
        const col = await this.collection();
        const prev = await col.findOne({ _id: id });
        if (!prev)
            return null;
        const now = new Date().toISOString();
        await col.updateOne({ _id: id }, {
            $set: {
                generated,
                ...(debugAssetGeneration !== undefined ? { debugAssetGeneration } : {}),
                updatedAt: now,
            },
        });
        const next = await col.findOne({ _id: id });
        return next ? this.fromDoc(next) : null;
    }
    /** Insert or replace by `id` (used when generating from an unsaved client-held job). */
    async upsertJob(record) {
        const now = new Date().toISOString();
        const col = await this.collection();
        const next = { ...record, updatedAt: now };
        const { createdAt, ...setFields } = next;
        await col.updateOne({ _id: record.id }, {
            $set: { ...setFields, _id: next.id },
            $setOnInsert: { createdAt: createdAt || now },
        }, { upsert: true });
        const saved = await col.findOne({ _id: record.id });
        if (!saved)
            return next;
        return this.fromDoc(saved);
    }
    async getRecent(limit = 20) {
        const col = await this.collection();
        const docs = await col.find({}).sort({ updatedAt: -1 }).limit(limit).toArray();
        return docs.map((d) => this.fromDoc(d));
    }
    async list(filters = {}) {
        const col = await this.collection();
        const query = {};
        if (filters.status)
            query.status = filters.status;
        if (filters.shortlist !== undefined)
            query["tracker.shortlist"] = filters.shortlist;
        if (filters.resume)
            query.recommendedResume = filters.resume;
        if (filters.recommendation)
            query.recommendation = filters.recommendation;
        if (filters.minScore !== undefined)
            query["score.total"] = { $gte: filters.minScore };
        if (filters.company)
            query["extracted.company"] = { $regex: filters.company, $options: "i" };
        const [docs, totalAll] = await Promise.all([
            col.find(query).sort({ updatedAt: -1 }).toArray(),
            col.countDocuments({}),
        ]);
        const items = docs.map((d) => this.fromDoc(d));
        return { items, total: items.length, totalAll };
    }
    async clearForTests() {
        const col = await this.collection();
        await col.deleteMany({});
    }
    async getById(id) {
        const col = await this.collection();
        const found = await col.findOne({ _id: id });
        return found ? this.fromDoc(found) : null;
    }
    async updateStatus(id, status, note) {
        const col = await this.collection();
        const prev = await col.findOne({ _id: id });
        if (!prev)
            return null;
        const prevJob = this.fromDoc(prev);
        const now = new Date().toISOString();
        const historyItem = {
            id: randomUUID(),
            jobId: prevJob.id,
            fromStatus: prevJob.status,
            toStatus: status,
            note: note?.trim() ? note.trim() : undefined,
            createdAt: now,
        };
        const nextTracker = {
            ...this.upsertTrackerFields(prevJob, status),
            ...(prevJob.tracker.notes !== undefined ? { notes: prevJob.tracker.notes } : {}),
        };
        const nextSpreadsheet = {
            ...prevJob.trackerSpreadsheet,
            statusOutcome: status,
        };
        await col.updateOne({ _id: id }, {
            $set: {
                status,
                tracker: nextTracker,
                trackerSpreadsheet: nextSpreadsheet,
                updatedAt: now,
            },
            $push: { statusHistory: historyItem },
        });
        const next = await col.findOne({ _id: id });
        return next ? this.fromDoc(next) : null;
    }
    async updateNotes(id, notes) {
        const col = await this.collection();
        const prev = await col.findOne({ _id: id });
        if (!prev)
            return null;
        const prevJob = this.fromDoc(prev);
        const now = new Date().toISOString();
        const nextSpreadsheet = {
            ...prevJob.trackerSpreadsheet,
            notes: notes.trim(),
        };
        await col.updateOne({ _id: id }, {
            $set: {
                tracker: { ...prevJob.tracker, notes: notes.trim() },
                trackerSpreadsheet: nextSpreadsheet,
                updatedAt: now,
            },
        });
        const next = await col.findOne({ _id: id });
        return next ? this.fromDoc(next) : null;
    }
    async exportRows(filters = {}) {
        const { items } = await this.list(filters);
        const rows = items.map((job) => buildJobExportRow(job));
        return { rows, total: rows.length };
    }
    /** Upsert by content-derived `importKey` (XLSX seed only; not live sync). Preserves `id` / `createdAt` when the key already exists. */
    async upsertByImportKey(record) {
        if (!record.importKey) {
            throw new Error("importKey is required for upsertByImportKey");
        }
        const col = await this.collection();
        const existing = await col.findOne({ importKey: record.importKey });
        const now = new Date().toISOString();
        if (existing) {
            const id = String(existing._id);
            const prev = this.fromDoc(existing);
            const next = {
                ...record,
                id,
                createdAt: prev.createdAt,
                updatedAt: now,
            };
            await col.replaceOne({ _id: id }, { ...next, _id: id });
            const saved = await col.findOne({ _id: id });
            return saved ? this.fromDoc(saved) : next;
        }
        const next = { ...record, updatedAt: now };
        await col.insertOne({ ...next, _id: next.id });
        return next;
    }
}
export const jobsRepository = new JobsRepository();
