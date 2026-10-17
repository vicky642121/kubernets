from fastapi import FastAPI
import uvicorn

app = FastAPI(title="Product Python API")


@app.get("/")
def read_root():
    return {"message": "Hello World"}

@app.get("/health")
async def health_check():
    return {
        "status": True, "message": "Product Python API is healthy!"
        }

@app.get("/products")
async def get_statistics():
    return {
        "status": True, "message": "Products fetched successfully!", "data": {
           "total_products": 3,
            "categories": ["Electronics", "Accessories"],
            "service": "Python FastAPI"
        }
        }



if __name__ == "__main__":
    uvicorn.run(
        "main:app", 
        host="0.0.0.0", 
        port=8000, 
        reload=True
    )