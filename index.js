// server.js
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

// Load environment variables
dotenv.config();

const stripe = require('stripe')(process.env.PAYMENT_GATEWAY_KEY);

const app = express();

// Middleware
app.use(cors());
app.use(express.json());




const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.knw8z6m.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();


        const db = client.db('profastDB');
        const userCollection = db.collection('users');
        const parcelsCollection = db.collection('parcels');
        const paymentHistoryCollection = db.collection('paymentHistory');


        // crud operation for Users
        app.post('/users', async (req, res) => {
            const email = req.body.email;
            const userExists = await userCollection.findOne({ email });
            if (userExists) {
                return res.status(200).json({ message: 'User already exists' });
            }

            const user = req.body;
            const result = await userCollection.insertOne(user);
            return res.send(result);
        })



        // Test route
        app.get('/', (req, res) => {
            res.send('Profast parcel delivery Server is running!');
        });

        // CREATE: Save a parcel
        app.post('/parcels', async (req, res) => {
            try {
                const parcel = req.body;
                const result = await parcelsCollection.insertOne(parcel);
                res.status(201).send(result);
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: 'Failed to save parcel' });
            }
        });

        // READ: Get all parcels
        // app.get('/parcels', async (req, res) => {
        //     try {
        //         const parcels = await parcelsCollection.find().toArray();
        //         res.send(parcels);
        //     } catch (err) {
        //         console.error(err);
        //         res.status(500).send({ message: 'Failed to fetch parcels' });
        //     }
        // });

        // READ: Get parcels by user email, sorted by latest first
        app.get('/parcels', async (req, res) => {
            try {
                const email = req.query.email;

                const query = email ? { created_by: email } : {};
                const parcels = await parcelsCollection
                    .find(query)
                    .sort({ creation_date: -1 }) // Sort by newest first
                    .toArray();

                res.send(parcels);
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: 'Failed to fetch parcels' });
            }
        });

        // get indivisual parcel
        app.get('/parcels/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const parcel = await parcelsCollection.findOne({ _id: new ObjectId(id) });

                if (!parcel) {
                    return res.status(404).send({ message: 'Parcel not found' });
                }

                res.send(parcel);
            } catch (err) {
                console.error('Get parcel by ID error:', err);
                res.status(500).send({ message: 'Failed to fetch parcel' });
            }
        });

        // parcel delete crud
        app.delete('/parcels/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const result = await parcelsCollection.deleteOne({ _id: new ObjectId(id) });
                res.send(result);
            } catch (err) {
                res.status(500).send({ message: 'Delete failed' });
            }
        });


        // PARCEL TRACKING RELATED API

        // added info of tracing parcel (pending)
        app.post('/parcel-tracking', async (req, res) => {
            try {
                const { trackingId, parcelId, status, location, note, updatedBy } = req.body;
                const trackingDoc = {
                    trackingId,
                    parcelId: new ObjectId(parcelId),
                    status,
                    location,
                    note,
                    updatedBy,
                    updatedAt: new Date()
                };
                const result = await parcelTrackingCollection.insertOne(trackingDoc);
                res.status(201).send(result);
            } catch (err) {
                console.error('Failed to insert tracking update:', err);
                res.status(500).send({ error: 'Failed to insert tracking data' });
            }
        });



        // PAYMENT RELATED API

        // GET: Payment history by user (descending)
        app.get('/payments', async (req, res) => {
            try {
                const email = req.query.email;
                const history = await paymentHistoryCollection
                    .find({ email: email })
                    .sort({ paid_at: -1 }) // Descending
                    .toArray();
                res.send(history);
            } catch (err) {
                res.status(500).send({ error: 'Failed to load payment history' });
            }
        });

        // POST: Mark as paid + Insert payment history
        app.post('/payments/confirm', async (req, res) => {
            try {
                const { parcelId, email, amount, transactionId, currency = 'BDT', paymentMethod = 'Stripe' } = req.body;

                const parcelObjectId = new ObjectId(parcelId);

                // 1. Update parcel's payment status
                const updateResult = await parcelsCollection.updateOne(
                    { _id: parcelObjectId },
                    {
                        $set: {
                            payment_status: 'paid'
                        }
                    }
                );

                if (updateResult.modifiedCount === 0) {
                    return res.status(404).json({ message: 'Parcel not found or already paid.' });
                }

                // 3. Insert payment history
                const historyDoc = {
                    parcelId: parcelObjectId,
                    email,
                    amount,
                    currency,
                    transactionId,
                    paymentMethod,
                    paid_at_string: new Date().toISOString(),
                    paid_at: new Date()
                };

                await paymentHistoryCollection.insertOne(historyDoc);

                res.status(200).json({ message: 'Payment confirmed and history saved.' });

            } catch (err) {
                console.error('Payment confirmation error:', err);
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // payment card
        app.post('/create-payment', async (req, res) => {
            const amountInCents = req.body.amountInCents;

            try {
                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amountInCents, //amount in cents
                    currency: 'usd',
                    payment_method_types: ['card'],
                });
                res.json({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });



        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


// Test route
app.get('/', (req, res) => {
    res.send('Profast parcel delivery Server is running!');
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`ProFast Server is running on port ${PORT}`);
});
