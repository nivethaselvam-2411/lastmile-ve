from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import random
import string
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
import uuid
from datetime import datetime, timezone


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

# ============= CONSTANTS =============

CAPACITY = {"auto": 3, "cab": 4}
BASE_FARE = {"auto": 60, "cab": 100}          # base fare
PER_KM = {"auto": 15, "cab": 22}              # per km fare
MATCH_WINDOW_SECS = 60                          # time to keep looking for pool mates

# Chennai hub seed data
HUBS_SEED = [
    {"id": "hub-ashok-pillar", "name": "Ashok Pillar Metro", "area": "K.K. Nagar",  "lat": 13.0263, "lng": 80.2075},
    {"id": "hub-vadapalani",   "name": "Vadapalani Metro",   "area": "Vadapalani",  "lat": 13.0507, "lng": 80.2062},
    {"id": "hub-srm-rmp",      "name": "SRM Ramapuram",      "area": "Ramapuram",   "lat": 13.0327, "lng": 80.1810},
    {"id": "hub-dlf-it",       "name": "DLF IT Park",        "area": "Manapakkam",  "lat": 13.0263, "lng": 80.1770},
    {"id": "hub-porur",        "name": "Porur Junction",     "area": "Porur",       "lat": 13.0389, "lng": 80.1565},
    {"id": "hub-guindy",       "name": "Guindy Metro",       "area": "Guindy",      "lat": 13.0067, "lng": 80.2206},
    {"id": "hub-ekkatuthangal", "name": "Ekkatuthangal Metro", "area": "Ekkatuthangal", "lat": 13.0134, "lng": 80.2013},
    {"id": "hub-alandur",      "name": "Alandur Metro",      "area": "Alandur",     "lat": 13.0035, "lng": 80.2036},
    {"id": "hub-anna-nagar",   "name": "Anna Nagar Tower",   "area": "Anna Nagar",  "lat": 13.0850, "lng": 80.2101},
    {"id": "hub-tidel-park",   "name": "Tidel Park Taramani","area": "Taramani",    "lat": 12.9915, "lng": 80.2437},
]


# ============= HELPERS =============

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def gen_pin():
    return "".join(random.choices(string.digits, k=4))

def haversine_km(a_lat, a_lng, b_lat, b_lng):
    from math import radians, sin, cos, asin, sqrt
    R = 6371
    dlat = radians(b_lat - a_lat)
    dlng = radians(b_lng - a_lng)
    x = sin(dlat/2)**2 + cos(radians(a_lat))*cos(radians(b_lat))*sin(dlng/2)**2
    return round(2*R*asin(sqrt(x)), 2)


# ============= MODELS =============

class User(BaseModel):
    id: str
    name: str
    phone: str
    role: Literal["passenger", "driver"]
    vehicle_number: Optional[str] = None
    created_at: str

class UserCreate(BaseModel):
    name: str
    phone: str
    role: Literal["passenger", "driver"]
    vehicle_number: Optional[str] = None

class Hub(BaseModel):
    id: str
    name: str
    area: str
    lat: float
    lng: float

class RideRequestCreate(BaseModel):
    passenger_id: str
    pickup_hub_id: str
    dropoff_hub_id: str
    vehicle_type: Literal["auto", "cab"]

class DriverAcceptBody(BaseModel):
    driver_id: str

class VerifyPinBody(BaseModel):
    passenger_id: str
    pin: str


# ============= DB INIT =============

@app.on_event("startup")
async def seed():
    # seed hubs
    existing = await db.hubs.count_documents({})
    if existing == 0:
        await db.hubs.insert_many(HUBS_SEED)
        logging.info(f"Seeded {len(HUBS_SEED)} hubs")


# ============= ROUTES =============

@api_router.get("/")
async def root():
    return {"message": "Last-Mile API"}

# ----- Auth (simple phone+name) -----

@api_router.post("/auth/register", response_model=User)
async def register(body: UserCreate):
    # check if user already exists with this phone + role
    existing = await db.users.find_one(
        {"phone": body.phone, "role": body.role}, {"_id": 0}
    )
    if existing:
        return User(**existing)
    user = {
        "id": str(uuid.uuid4()),
        "name": body.name,
        "phone": body.phone,
        "role": body.role,
        "vehicle_number": body.vehicle_number,
        "created_at": now_iso(),
    }
    await db.users.insert_one(user)
    user.pop("_id", None)
    return User(**user)


@api_router.get("/users/{user_id}", response_model=User)
async def get_user(user_id: str):
    u = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not u:
        raise HTTPException(404, "User not found")
    return User(**u)


# ----- Hubs -----

@api_router.get("/hubs", response_model=List[Hub])
async def list_hubs():
    hubs = await db.hubs.find({}, {"_id": 0}).to_list(1000)
    return [Hub(**h) for h in hubs]


# ----- Ride request + matching -----

async def _recompute_shared_fare(shared_ride):
    """Distribute total fare across current passenger_ids."""
    n = len(shared_ride["passenger_ids"])
    per = round(shared_ride["total_fare"] / n) if n > 0 else shared_ride["total_fare"]
    shared_ride["per_passenger_fare"] = per
    await db.shared_rides.update_one(
        {"id": shared_ride["id"]},
        {"$set": {"per_passenger_fare": per}}
    )
    # update all matched ride_requests fare_share
    await db.ride_requests.update_many(
        {"shared_ride_id": shared_ride["id"]},
        {"$set": {"fare_share": per}}
    )
    return per


@api_router.post("/rides/request")
async def request_ride(body: RideRequestCreate):
    # validate hubs
    if body.pickup_hub_id == body.dropoff_hub_id:
        raise HTTPException(400, "Pickup and dropoff must differ")
    pickup = await db.hubs.find_one({"id": body.pickup_hub_id}, {"_id": 0})
    dropoff = await db.hubs.find_one({"id": body.dropoff_hub_id}, {"_id": 0})
    if not pickup or not dropoff:
        raise HTTPException(404, "Hub not found")

    # cancel any prior pending request for this passenger
    await db.ride_requests.update_many(
        {"passenger_id": body.passenger_id, "status": {"$in": ["searching", "matched"]}},
        {"$set": {"status": "cancelled"}}
    )

    distance_km = haversine_km(pickup["lat"], pickup["lng"], dropoff["lat"], dropoff["lng"])
    total_fare = round(BASE_FARE[body.vehicle_type] + PER_KM[body.vehicle_type] * distance_km)
    capacity = CAPACITY[body.vehicle_type]

    # find a poolable shared_ride (same hubs, same vehicle, pending, not full)
    candidate = await db.shared_rides.find_one({
        "pickup_hub_id": body.pickup_hub_id,
        "dropoff_hub_id": body.dropoff_hub_id,
        "vehicle_type": body.vehicle_type,
        "status": "pending",
        "$expr": {"$lt": [{"$size": "$passenger_ids"}, "$capacity"]},
    }, {"_id": 0})

    pin = gen_pin()
    ride_req_id = str(uuid.uuid4())

    if candidate:
        # join existing pool
        await db.shared_rides.update_one(
            {"id": candidate["id"]},
            {"$push": {"passenger_ids": body.passenger_id}}
        )
        candidate["passenger_ids"].append(body.passenger_id)
        shared_ride_id = candidate["id"]
        # ride request
        rr = {
            "id": ride_req_id,
            "passenger_id": body.passenger_id,
            "pickup_hub_id": body.pickup_hub_id,
            "dropoff_hub_id": body.dropoff_hub_id,
            "vehicle_type": body.vehicle_type,
            "status": "matched",  # pool exists but driver not yet accepted
            "shared_ride_id": shared_ride_id,
            "fare_share": 0,
            "pin": pin,
            "created_at": now_iso(),
        }
        await db.ride_requests.insert_one(rr)
        # recompute fare
        await _recompute_shared_fare(candidate)
    else:
        # create new pool
        shared_ride_id = str(uuid.uuid4())
        new_shared = {
            "id": shared_ride_id,
            "pickup_hub_id": body.pickup_hub_id,
            "dropoff_hub_id": body.dropoff_hub_id,
            "vehicle_type": body.vehicle_type,
            "capacity": capacity,
            "passenger_ids": [body.passenger_id],
            "distance_km": distance_km,
            "total_fare": total_fare,
            "per_passenger_fare": total_fare,  # solo fare initially
            "status": "pending",  # waiting for driver
            "driver_id": None,
            "driver_name": None,
            "vehicle_number": None,
            "created_at": now_iso(),
            "accepted_at": None,
            "completed_at": None,
            "verified_passenger_ids": [],
        }
        await db.shared_rides.insert_one(new_shared)
        rr = {
            "id": ride_req_id,
            "passenger_id": body.passenger_id,
            "pickup_hub_id": body.pickup_hub_id,
            "dropoff_hub_id": body.dropoff_hub_id,
            "vehicle_type": body.vehicle_type,
            "status": "searching",
            "shared_ride_id": shared_ride_id,
            "fare_share": total_fare,
            "pin": pin,
            "created_at": now_iso(),
        }
        await db.ride_requests.insert_one(rr)

    rr.pop("_id", None)
    return rr


async def _hydrate_shared_ride(sr):
    if not sr:
        return None
    sr.pop("_id", None)
    pickup = await db.hubs.find_one({"id": sr["pickup_hub_id"]}, {"_id": 0})
    dropoff = await db.hubs.find_one({"id": sr["dropoff_hub_id"]}, {"_id": 0})
    passengers = await db.users.find({"id": {"$in": sr["passenger_ids"]}}, {"_id": 0}).to_list(20)
    # attach passenger PINs from their ride_requests
    reqs = await db.ride_requests.find(
        {"shared_ride_id": sr["id"], "status": {"$in": ["searching", "matched", "in_progress", "completed"]}},
        {"_id": 0}
    ).to_list(20)
    pin_map = {r["passenger_id"]: r["pin"] for r in reqs}
    for p in passengers:
        p["pin"] = pin_map.get(p["id"], "----")
    sr["pickup"] = pickup
    sr["dropoff"] = dropoff
    sr["passengers"] = passengers
    return sr


@api_router.get("/rides/request/{req_id}")
async def get_ride_request(req_id: str):
    rr = await db.ride_requests.find_one({"id": req_id}, {"_id": 0})
    if not rr:
        raise HTTPException(404, "Request not found")
    # promote status: if shared_ride now accepted, mark request as in_progress
    sr = await db.shared_rides.find_one({"id": rr["shared_ride_id"]}, {"_id": 0})
    if sr:
        # update status based on shared_ride
        if sr["status"] == "accepted" and rr["status"] in ("searching", "matched"):
            await db.ride_requests.update_one({"id": req_id}, {"$set": {"status": "in_progress"}})
            rr["status"] = "in_progress"
        elif sr["status"] == "completed":
            await db.ride_requests.update_one({"id": req_id}, {"$set": {"status": "completed"}})
            rr["status"] = "completed"
        elif sr["status"] == "pending" and len(sr["passenger_ids"]) > 1 and rr["status"] == "searching":
            await db.ride_requests.update_one({"id": req_id}, {"$set": {"status": "matched"}})
            rr["status"] = "matched"
    hydrated = await _hydrate_shared_ride(sr) if sr else None
    return {"request": rr, "shared_ride": hydrated}


@api_router.post("/rides/request/{req_id}/cancel")
async def cancel_request(req_id: str):
    rr = await db.ride_requests.find_one({"id": req_id}, {"_id": 0})
    if not rr:
        raise HTTPException(404, "Not found")
    if rr["status"] in ("completed", "cancelled"):
        return {"ok": True}
    # remove from shared_ride if still pending
    sr = await db.shared_rides.find_one({"id": rr["shared_ride_id"]}, {"_id": 0})
    if sr and sr["status"] == "pending":
        await db.shared_rides.update_one(
            {"id": sr["id"]},
            {"$pull": {"passenger_ids": rr["passenger_id"]}}
        )
        sr["passenger_ids"] = [p for p in sr["passenger_ids"] if p != rr["passenger_id"]]
        if len(sr["passenger_ids"]) == 0:
            await db.shared_rides.update_one({"id": sr["id"]}, {"$set": {"status": "cancelled"}})
        else:
            await _recompute_shared_fare(sr)
    await db.ride_requests.update_one({"id": req_id}, {"$set": {"status": "cancelled"}})
    return {"ok": True}


# ----- Driver -----

@api_router.get("/rides/available")
async def available_rides():
    """List pending shared_rides for drivers to accept."""
    rides = await db.shared_rides.find(
        {"status": "pending", "passenger_ids": {"$ne": []}}, {"_id": 0}
    ).sort("created_at", -1).to_list(50)
    result = []
    for sr in rides:
        h = await _hydrate_shared_ride(sr)
        result.append(h)
    return result


@api_router.post("/rides/shared/{ride_id}/accept")
async def accept_ride(ride_id: str, body: DriverAcceptBody):
    sr = await db.shared_rides.find_one({"id": ride_id}, {"_id": 0})
    if not sr:
        raise HTTPException(404, "Ride not found")
    if sr["status"] != "pending":
        raise HTTPException(400, "Ride not available")
    driver = await db.users.find_one({"id": body.driver_id, "role": "driver"}, {"_id": 0})
    if not driver:
        raise HTTPException(404, "Driver not found")
    await db.shared_rides.update_one(
        {"id": ride_id, "status": "pending"},
        {"$set": {
            "status": "accepted",
            "driver_id": body.driver_id,
            "driver_name": driver["name"],
            "vehicle_number": driver.get("vehicle_number") or "TN-XX-1234",
            "accepted_at": now_iso(),
        }}
    )
    updated = await db.shared_rides.find_one({"id": ride_id}, {"_id": 0})
    # promote all matching ride_requests
    await db.ride_requests.update_many(
        {"shared_ride_id": ride_id, "status": {"$in": ["searching", "matched"]}},
        {"$set": {"status": "in_progress"}}
    )
    return await _hydrate_shared_ride(updated)


@api_router.post("/rides/shared/{ride_id}/verify-pin")
async def verify_pin(ride_id: str, body: VerifyPinBody):
    rr = await db.ride_requests.find_one(
        {"shared_ride_id": ride_id, "passenger_id": body.passenger_id}, {"_id": 0}
    )
    if not rr:
        raise HTTPException(404, "Passenger not in ride")
    if rr["pin"] != body.pin:
        raise HTTPException(400, "Wrong PIN")
    await db.shared_rides.update_one(
        {"id": ride_id},
        {"$addToSet": {"verified_passenger_ids": body.passenger_id}}
    )
    return {"ok": True}


@api_router.post("/rides/shared/{ride_id}/complete")
async def complete_ride(ride_id: str):
    sr = await db.shared_rides.find_one({"id": ride_id}, {"_id": 0})
    if not sr:
        raise HTTPException(404, "Not found")
    if sr["status"] != "accepted":
        raise HTTPException(400, "Cannot complete")
    await db.shared_rides.update_one(
        {"id": ride_id},
        {"$set": {"status": "completed", "completed_at": now_iso()}}
    )
    await db.ride_requests.update_many(
        {"shared_ride_id": ride_id, "status": "in_progress"},
        {"$set": {"status": "completed"}}
    )
    updated = await db.shared_rides.find_one({"id": ride_id}, {"_id": 0})
    return await _hydrate_shared_ride(updated)


@api_router.get("/rides/shared/{ride_id}")
async def get_shared_ride(ride_id: str):
    sr = await db.shared_rides.find_one({"id": ride_id}, {"_id": 0})
    if not sr:
        raise HTTPException(404, "Not found")
    return await _hydrate_shared_ride(sr)


# ----- History -----

@api_router.get("/rides/history/passenger/{user_id}")
async def passenger_history(user_id: str):
    reqs = await db.ride_requests.find(
        {"passenger_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    out = []
    for r in reqs:
        sr = await db.shared_rides.find_one({"id": r["shared_ride_id"]}, {"_id": 0})
        h = await _hydrate_shared_ride(sr) if sr else None
        out.append({"request": r, "shared_ride": h})
    return out


@api_router.get("/rides/history/driver/{user_id}")
async def driver_history(user_id: str):
    rides = await db.shared_rides.find(
        {"driver_id": user_id}, {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return [await _hydrate_shared_ride(sr) for sr in rides]


# ============= APP SETUP =============

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
