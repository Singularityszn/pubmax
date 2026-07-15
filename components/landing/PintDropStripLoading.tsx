export default function PintDropStripLoading() {
  return (
    <div className="dropStrip" aria-hidden="true">
      <div className="dropStripRail">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="dropStripCard dropStripCardSkeleton" key={index}>
            <span className="skelLine skelLineTop" />
            <span className="skelLine" />
            <span className="skelLine skelLineShort" />
          </div>
        ))}
      </div>
    </div>
  );
}
